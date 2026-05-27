import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { registerProvider } from "./providers/registry";
import { getcomicsProvider } from "./providers/getcomics/index";
import { rssProvider } from "./providers/rss/index";
import { manualUrlProvider } from "./providers/manual-url/index";
import { digitalComicMuseumProvider } from "./providers/digitalcomicmuseum/index";
import { zipcomicProvider } from "./providers/zipcomic/index";
import { internetArchiveProvider } from "./providers/internetarchive/index";
import { sourceRoutes } from "./routes/sources";
import { catalogRoutes } from "./routes/catalog";
import { downloadRoutes } from "./routes/downloads";
import { cacheRoutes } from "./routes/cache";
import { providerRoutes } from "./routes/providers";
import { libraryRoutes, setSetting, LAST_SCAN_ALL_KEY } from "./routes/library";
import { settingsRoutes } from "./routes/settings";
import { scanAllSources } from "./services/library-scanner";
import { shutdownPlaywright } from "./providers/playwright-bypass";
import fs from "node:fs";

async function main() {
  // Ensure data directories exist
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  if (!fs.existsSync(config.downloadDir)) {
    fs.mkdirSync(config.downloadDir, { recursive: true });
  }

  // Run database migrations
  console.log("[PanelShelf] Running migrations...");
  runMigrations();

  // Register providers — specific providers first so they match before the catch-all providers
  registerProvider(getcomicsProvider);
  registerProvider(digitalComicMuseumProvider);
  registerProvider(zipcomicProvider);
  registerProvider(internetArchiveProvider);
  registerProvider(manualUrlProvider);  // catch-all: matches any URL (registered after specific providers)
  registerProvider(rssProvider);        // catch-all: matches any URL
  console.log(
    "[PanelShelf] Registered providers: getcomics, digitalcomicmuseum, zipcomic, internetarchive, manual-url, rss"
  );

  // Create Fastify server
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Swagger/OpenAPI spec (always registered so routes can contribute schemas)
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "PanelShelf API",
        description: "Comic catalog management API — search, download, and manage your comic collection",
        version: "0.1.0",
      },
      servers: [{ url: `http://localhost:${config.port}` }],
    },
  });

  // Scalar API reference docs (dev only)
  if (config.isDev) {
    await app.register(scalarApiReference, {
      routePrefix: "/docs",
      configuration: {
        title: "PanelShelf API",
        favicon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZzEiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzYzNjZmMSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0ZjQ2ZTUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImcyIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNhNzhiZmEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjN2MzYWVkIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8IS0tIFNoZWxmIGJhY2sgLS0+CiAgPHJlY3QgeD0iNCIgeT0iMjAiIHdpZHRoPSIyNCIgaGVpZ2h0PSIzIiByeD0iMSIgZmlsbD0iIzM3NDE1MSIgLz4KICA8IS0tIFNoZWxmIHNoYWRvdyAtLT4KICA8cmVjdCB4PSI0IiB5PSIyMyIgd2lkdGg9IjI0IiBoZWlnaHQ9IjEiIHJ4PSIwLjUiIGZpbGw9IiMxZjI5MzciIC8+CiAgPCEtLSBCb29rIDEgLSB0aGljaywgaW5kaWdvIC0tPgogIDxyZWN0IHg9IjYiIHk9IjgiIHdpZHRoPSI2IiBoZWlnaHQ9IjEzIiByeD0iMSIgZmlsbD0idXJsKCNnMSkiIC8+CiAgPHJlY3QgeD0iNiIgeT0iOCIgd2lkdGg9IjYiIGhlaWdodD0iMiIgcng9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xNSkiIC8+CiAgPCEtLSBCb29rIDEgc3BpbmUgbGluZSAtLT4KICA8bGluZSB4MT0iOSIgeTE9IjExIiB4Mj0iOSIgeTI9IjE5IiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4zKSIgc3Ryb2tlLXdpZHRoPSIwLjUiIC8+CiAgPCEtLSBCb29rIDIgLSB0aGlubmVyLCBwdXJwbGUgLS0+CiAgPHJlY3QgeD0iMTMiIHk9IjExIiB3aWR0aD0iNCIgaGVpZ2h0PSIxMCIgcng9IjAuOCIgZmlsbD0idXJsKCNnMikiIC8+CiAgPCEtLSBCb29rIDIgc3BpbmUgLS0+CiAgPGxpbmUgeDE9IjE1IiB5MT0iMTQiIHgyPSIxNSIgeTI9IjE5IiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4yNSkiIHN0cm9rZS13aWR0aD0iMC41IiAvPgogIDwhLS0gQm9vayAzIC0gbWVkaXVtLCBibHVlLWdyYXkgLS0+CiAgPHJlY3QgeD0iMTgiIHk9IjYiIHdpZHRoPSI1IiBoZWlnaHQ9IjE1IiByeD0iMC44IiBmaWxsPSIjNjM2NmYxIiAvPgogIDxyZWN0IHg9IjE4IiB5PSI2IiB3aWR0aD0iNSIgaGVpZ2h0PSIyIiByeD0iMC44IiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMTIpIiAvPgogIDwhLS0gQm9vayAzIHNwaW5lIC0tPgogIDxsaW5lIHgxPSIyMC41IiB5MT0iOSIgeDI9IjIwLjUiIHkyPSIxOSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMikiIHN0cm9rZS13aWR0aD0iMC41IiAvPgogIDwhLS0gQm9vayA0IC0gdGhpbiwgdmlvbGV0IC0tPgogIDxyZWN0IHg9IjI0IiB5PSIxMyIgd2lkdGg9IjMiIGhlaWdodD0iOCIgcng9IjAuNiIgZmlsbD0iIzhiNWNmNiIgLz4KICA8IS0tIExlZnQgc2lkZSBwYW5lbCAtLT4KICA8cmVjdCB4PSIzIiB5PSI1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxOCIgcng9IjAuMyIgZmlsbD0iIzRiNTU2MyIgLz4KICA8IS0tIFJpZ2h0IHNpZGUgcGFuZWwgLS0+CiAgPHJlY3QgeD0iMjgiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjE4IiByeD0iMC4zIiBmaWxsPSIjNGI1NTYzIiAvPgo8L3N2Zz4K",
        darkMode: true,
        layout: "modern",

        customCss: `
/* ── PanelShelf Brand Theme ────────────────────────────── */

/* Base colors — dark navy inspired by the PanelShelf UI */
:root {
  --scalar-color-1: #e2e8f0;
  --scalar-color-2: #94a3b8;
  --scalar-color-3: #64748b;
  --scalar-color-accent: #5c7cfa;
  --scalar-color-accent-hover: #4c6ef5;
  --scalar-background-1: #0f0f1a;
  --scalar-background-2: #1a1a2e;
  --scalar-background-3: #222240;
  --scalar-border-color: #2a2a4a;

  /* Sidebar */
  --scalar-sidebar-background-1: #0f0f1a;
  --scalar-sidebar-item-hover-background: #1a1a2e;
  --scalar-sidebar-item-active-background: #222240;

  /* Typography */
  --scalar-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --scalar-font-code: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  /* Sizing & Radii */
  --scalar-radius: 6px;
  --scalar-radius-lg: 10px;
  --scalar-radius-xl: 14px;

  /* Status colors */
  --scalar-color-green: #22c55e;
  --scalar-color-red: #ef4444;
  --scalar-color-yellow: #eab308;
  --scalar-color-orange: #f97316;
  --scalar-color-blue: #5c7cfa;

}

/* ── Header / Top Navigation ── */
.scalar-api-reference .header {
  background: linear-gradient(180deg, #12122a 0%, #0f0f1a 100%);
  border-bottom: 1px solid #2a2a4a;
}

.scalar-api-reference .header h1 {
  color: #e2e8f0;
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* ── Logo / Brand area ── */
.scalar-api-reference .brand {
  gap: 10px;
}

.scalar-api-reference .brand .title {
  color: #e2e8f0;
  font-size: 16px;
  font-weight: 600;
}

.scalar-api-reference .brand .subtitle {
  color: #64748b;
  font-size: 12px;
}

/* ── Sidebar ── */
.scalar-api-reference .sidebar {
  background: #0f0f1a;
  border-right: 1px solid #2a2a4a;
}

.scalar-api-reference .sidebar .sidebar-heading {
  color: #64748b;
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 12px 16px 6px;
}

.scalar-api-reference .sidebar a {
  color: #94a3b8;
  transition: all 0.15s ease;
  border-radius: 6px;
  margin: 1px 8px;
  padding: 6px 12px;
  font-size: 13px;
}

.scalar-api-reference .sidebar a:hover {
  color: #e2e8f0;
  background: #1a1a2e;
}

.scalar-api-reference .sidebar a.active {
  color: #5c7cfa;
  background: #1a1a2e;
  font-weight: 500;
}

/* ── Section Cards (Operation) ── */
.scalar-api-reference .section {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 10px;
  margin: 12px 0;
  transition: border-color 0.2s ease;
}

.scalar-api-reference .section:hover {
  border-color: #3a3a6a;
}

/* ── Operation headers (GET/POST etc.) ── */
.scalar-api-reference .operation .method {
  border-radius: 5px;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  padding: 3px 8px;
}

.scalar-api-reference .operation .method.get {
  background: #1a3a3a;
  color: #22d3ee;
}

.scalar-api-reference .operation .method.post {
  background: #1a2e1a;
  color: #4ade80;
}

.scalar-api-reference .operation .method.put {
  background: #2a2a1a;
  color: #facc15;
}

.scalar-api-reference .operation .method.delete {
  background: #2e1a1a;
  color: #f87171;
}

.scalar-api-reference .operation .method.patch {
  background: #2a1a2e;
  color: #c084fc;
}

/* ── Tab buttons ── */
.scalar-api-reference .tabs button {
  color: #64748b;
  transition: color 0.15s;
}

.scalar-api-reference .tabs button:hover {
  color: #cbd5e1;
}

.scalar-api-reference .tabs button.active {
  color: #5c7cfa;
  border-bottom-color: #5c7cfa;
}

/* ── Code blocks / JSON response ── */
.scalar-api-reference pre,
.scalar-api-reference code {
  background: #0f0f1a;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
}

.scalar-api-reference code {
  padding: 2px 6px;
  background: #1a1a2e;
}

/* ── Table (schema properties) ── */
.scalar-api-reference table {
  border-color: #2a2a4a;
}

.scalar-api-reference table th {
  background: #1a1a2e;
  color: #94a3b8;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.scalar-api-reference table td {
  border-color: #2a2a4a;
  color: #cbd5e1;
}

/* ── Inputs ── */
.scalar-api-reference input,
.scalar-api-reference select,
.scalar-api-reference textarea {
  background: #0f0f1a;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  color: #e2e8f0;
  padding: 8px 12px;
  font-size: 13px;
  transition: border-color 0.2s;
}

.scalar-api-reference input:focus,
.scalar-api-reference select:focus,
.scalar-api-reference textarea:focus {
  border-color: #5c7cfa;
  outline: none;
  box-shadow: 0 0 0 2px rgba(92, 124, 250, 0.15);
}

/* ── Try It / Test Request button ── */
.scalar-api-reference .try-it-btn,
.scalar-api-reference .send-request-btn {
  background: #5c7cfa;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.scalar-api-reference .try-it-btn:hover,
.scalar-api-reference .send-request-btn:hover {
  background: #4c6ef5;
}

/* ── Response viewer ── */
.scalar-api-reference .response-status {
  border-radius: 6px;
  font-weight: 600;
  padding: 4px 10px;
  font-size: 12px;
}

.scalar-api-reference .response-status.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.scalar-api-reference .response-status.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* ── Scrollbar styling ── */
.scalar-api-reference ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.scalar-api-reference ::-webkit-scrollbar-track {
  background: #1a1a2e;
}

.scalar-api-reference ::-webkit-scrollbar-thumb {
  background: #3b5bdb;
  border-radius: 4px;
}

.scalar-api-reference ::-webkit-scrollbar-thumb:hover {
  background: #4c6ef5;
}

/* ── Dark mode toggle icon ── */
.scalar-api-reference .dark-mode-toggle {
  color: #64748b;
  transition: color 0.15s;
}

.scalar-api-reference .dark-mode-toggle:hover {
  color: #e2e8f0;
}

/* ── Search box ── */
.scalar-api-reference .search-input {
  background: #0f0f1a;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  color: #e2e8f0;
}

.scalar-api-reference .search-input:focus {
  border-color: #5c7cfa;
}

/* ── Tag/Section groups (matching the tags we added) ── */
.scalar-api-reference .tag-group {
  margin-top: 8px;
}

.scalar-api-reference .tag-group .tag-label {
  color: #5c7cfa;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.01em;
  padding: 8px 0;
}

/* ── Description text ── */
.scalar-api-reference .description {
  color: #94a3b8;
  line-height: 1.6;
  font-size: 14px;
}

.scalar-api-reference .description strong {
  color: #cbd5e1;
}

/* ── Loading state ── */
.scalar-api-reference .loading {
  color: #64748b;
}

/* ── Tooltip ── */
.scalar-api-reference .tooltip {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
}
`,
      },
    });
    console.log(`[PanelShelf] API docs available at http://localhost:${config.port}/docs`);
  }

  // Health check
  app.get("/api/health", {
    schema: {
      tags: ["System"],
      summary: "Health check",
      description: "Returns server status, version, and uptime. Used by monitoring tools and the frontend to verify connectivity.",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok"] },
            version: { type: "string" },
            uptime: { type: "number" },
          },
        },
      },
    },
  }, async () => ({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  }));

  // Register routes
  sourceRoutes(app);
  catalogRoutes(app);
  downloadRoutes(app);
  cacheRoutes(app);
  providerRoutes(app);
  libraryRoutes(app);
  settingsRoutes(app);

  // Static file serving for production frontend
  const frontendDist = new URL("../../../frontend/dist", import.meta.url);
  if (fs.existsSync(frontendDist)) {
    await app.register(import("@fastify/static"), {
      root: frontendDist.pathname,
      prefix: "/",
    });
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html");
    });
  }

  // Start
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[PanelShelf] Server running on http://${config.host}:${config.port}`);

    // Graceful shutdown — close Playwright browser on process exit
    const gracefulShutdown = async () => {
      try {
        await shutdownPlaywright();
        await app.close();
      } finally {
        process.exit(0);
      }
    };
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);

    // Auto-scan all library sources on startup (non-blocking, runs after server is ready)
    if (config.autoScanOnStart) {
      console.log("[PanelShelf] AUTO_SCAN_ON_START enabled — scanning all library sources...");
      scanAllSources()
        .then(({ results }) => {
          const totalAdded = results.reduce((s, r) => s + r.added, 0);
          const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
          // Persist the scan-all timestamp so the frontend shows accurate "Last scan" time
          setSetting(LAST_SCAN_ALL_KEY, new Date().toISOString());
          console.log(
            `[PanelShelf] Auto-scan complete: ${results.length} source(s) scanned, ${totalAdded} new, ${totalErrors} error(s)`
          );
        })
        .catch((err) => {
          console.error("[PanelShelf] Auto-scan failed:", err.message);
        });
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
