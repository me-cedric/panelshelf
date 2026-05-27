import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";

// Apply the stealth plugin to evade bot detection (fingerprint masking, etc.)
chromium.use(StealthPlugin());

// ── Browser lifecycle ──

let browser: Browser | null = null;
let browserRefs = 0;

/** Max time to wait for a page to fully load (including Cloudflare challenges). */
const PAGE_LOAD_TIMEOUT_MS = 60_000;

/**
 * Launch a persistent headless Chromium browser with realistic viewport & user agent.
 * Reuses the same browser instance across requests to maintain cached state.
 */
async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    browserRefs++;
    return browser;
  }

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  // Handle unexpected browser crash/disconnect.
  // Only clear the browser reference — do NOT reset browserRefs to 0
  // because in-flight requests will still call releaseBrowser() in their
  // finally blocks, which needs to decrement the existing ref counts.
  browser.on("disconnected", () => {
    browser = null;
  });

  browserRefs++;
  return browser;
}

/**
 * Release a browser reference. If no more references, kill the browser.
 */
async function releaseBrowser(): Promise<void> {
  browserRefs--;
  if (browserRefs <= 0 && browser) {
    try {
      await browser.close();
    } catch {
      // ignore close errors
    }
    browser = null;
    browserRefs = 0;
  }
}

/**
 * Shut down the browser entirely (called on app shutdown).
 */
export async function shutdownPlaywright(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
    browserRefs = 0;
  }
}

// ── Public API ──

/**
 * Fetch a URL's rendered HTML via headless Chromium, bypassing Cloudflare
 * challenges (Turnstile, "Just a moment", etc.).
 *
 * Uses a fresh browser context per request to avoid state contamination,
 * but reuses the underlying browser process for efficiency.
 *
 * Returns the full HTML after the page has loaded and any Cloudflare
 * challenges have been resolved, or null if the fetch failed.
 */
export async function fetchViaPlaywright(
  url: string,
  options?: { signal?: AbortSignal; maxTimeout?: number }
): Promise<string | null> {
  const timeout = options?.maxTimeout ?? PAGE_LOAD_TIMEOUT_MS;

  let ctx: BrowserContext | null = null;

  try {
    const b = await getBrowser();

    // Create a fresh context with a realistic viewport and locale
    ctx = await b.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
      // Enable JavaScript (required for CF challenges)
      javaScriptEnabled: true,
    });

    const page = await ctx.newPage();

    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Sec-Ch-Ua":
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
    });

    // Support abort via signal — close the entire context on abort
    if (options?.signal) {
      const onAbort = () => {
        ctx?.close().catch(() => {});
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Navigate to the page.
    // Use 'domcontentloaded' instead of 'networkidle' — Cloudflare-protected
    // pages often have persistent JS connections (analytics, polling) that
    // prevent networkidle from ever resolving.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    // Poll for Cloudflare challenge to resolve.
    // Turnstile managed challenges auto-resolve in the browser after JS execution.
    // We check every 2s for up to the remaining timeout, or until CF markers disappear.
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (options?.signal?.aborted) {
        await ctx.close();
        return null;
      }

      const currentHtml = await page.content();
      const stillBlocked =
        currentHtml.includes("Just a moment") ||
        currentHtml.includes("cf-browser-verification") ||
        currentHtml.includes("__cf_chl") ||
        currentHtml.includes("Checking your browser") ||
        currentHtml.includes("cf-turnstile");

      if (!stillBlocked) {
        break; // Challenge resolved!
      }

      // Still blocked — wait a bit and try again
      await page.waitForTimeout(2000);
    }

    // Get the final rendered HTML
    const html = await page.content();

    await ctx.close();
    return html;
  } catch (err: any) {
    // Clean up context on error
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        // ignore
      }
    }

    // Don't log abort errors — they're expected
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      return null;
    }

    console.error(`[Playwright] Failed to fetch ${url}:`, err.message);
    return null;
  } finally {
    await releaseBrowser();
  }
}

