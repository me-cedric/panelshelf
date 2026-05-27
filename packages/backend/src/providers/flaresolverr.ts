import { request } from "undici";
import { config } from "../config";

interface FlareSolverrResponse {
  status: "ok" | "error";
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
  solution?: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string;
    cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; size: number; httpOnly: boolean; secure: boolean; session: boolean; sameSite: string }>;
    userAgent: string;
  };
}

/**
 * Fetch a URL via FlareSolverr, bypassing Cloudflare bot protection.
 * Returns the solved HTML response body.
 *
 * Throws if FlareSolverr is not configured, returns null if the solve failed.
 */
export async function fetchViaFlareSolverr(
  url: string,
  options?: { signal?: AbortSignal; maxTimeout?: number }
): Promise<string | null> {
  if (!config.flareSolverrUrl) {
    throw new Error("FlareSolverr is not configured — set FLARESOLVERR_URL in your environment");
  }

  const body = JSON.stringify({
    cmd: "request.get",
    url,
    maxTimeout: options?.maxTimeout ?? 60000,
  });

  const resp = await request(config.flareSolverrUrl, {
    method: "POST",
    signal: options?.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (resp.statusCode !== 200) {
    throw new Error(`FlareSolverr returned HTTP ${resp.statusCode}`);
  }

  const data = JSON.parse(await resp.body.text()) as FlareSolverrResponse;

  if (data.status !== "ok" || !data.solution) {
    throw new Error(`FlareSolverr failed: ${data.message}`);
  }

  return data.solution.response;
}

/**
 * Returns true when FlareSolverr is configured and available.
 */
export function isFlareSolverrConfigured(): boolean {
  return Boolean(config.flareSolverrUrl);
}
