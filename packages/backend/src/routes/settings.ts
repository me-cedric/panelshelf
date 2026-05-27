import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const SETTINGS_FILE = path.join(config.dataDir, "settings.json");

interface AppSettings {
  downloadDirectory?: string;
  [key: string]: unknown;
}

function readSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore — return defaults
  }
  return {};
}

function writeSettings(settings: AppSettings): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

export function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings — return all settings
  app.get("/api/settings", {
    schema: {
      tags: ["Settings"],
      summary: "Get all settings",
      description: "Returns all persisted application settings (download directory, etc.).",
      response: {
        200: {
          type: "object",
          properties: {
            settings: {
              type: "object",
              description: "Key-value settings map",
            },
          },
        },
      },
    },
  }, async () => {
    return { settings: readSettings() };
  });

  // POST /api/settings — update one or more settings
  app.post("/api/settings", {
    schema: {
      tags: ["Settings"],
      summary: "Update settings",
      description: "Updates application settings (e.g., download directory). Merges with existing settings.",
      body: {
        type: "object",
        description: "Key-value pairs to merge into settings",
        additionalProperties: true,
      },
      response: {
        200: {
          type: "object",
          properties: {
            settings: {
              type: "object",
              description: "Updated settings map",
            },
          },
        },
      },
    },
  }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const current = readSettings();
    const updated = { ...current, ...body };
    writeSettings(updated);
    return { settings: updated };
  });
}
