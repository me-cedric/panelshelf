import type { FastifyInstance } from "fastify";
import {
  getDownloads,
  enqueueDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  cancelDownload,
} from "../services/download-manager";

export function downloadRoutes(app: FastifyInstance) {
  // List downloads
  app.get("/api/downloads", {
    schema: {
      tags: ["Downloads"],
      summary: "List downloads",
      description: "Returns all downloads with optional status filter and pagination.",
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "running", "paused", "completed", "failed"], description: "Filter by download status" },
          limit: { type: "string", pattern: "^\\d+$", default: "50", description: "Items per page" },
          offset: { type: "string", pattern: "^\\d+$", default: "0", description: "Page offset" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            items: { type: "array" },
            total: { type: "integer" },
          },
        },
      },
    },
  }, async (req) => {
    const query = req.query as { status?: string; limit?: string; offset?: string };
    return getDownloads({
      status: query.status,
      limit: parseInt(query.limit || "50", 10),
      offset: parseInt(query.offset || "0", 10),
    });
  });

  // Enqueue download from a download link
  app.post("/api/downloads", {
    schema: {
      tags: ["Downloads"],
      summary: "Enqueue a download",
      description: "Adds a download to the queue from a catalog item's download link ID.",
      body: {
        type: "object",
        required: ["downloadLinkId"],
        properties: {
          downloadLinkId: { type: "string", format: "uuid", description: "Download link ID from a catalog item" },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          properties: {
            downloadId: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { downloadLinkId: string };
    if (!body.downloadLinkId) {
      return reply.status(400).send({ error: "downloadLinkId is required" });
    }
    try {
      const id = await enqueueDownload(body.downloadLinkId);
      return { downloadId: id };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Pause download
  app.post("/api/downloads/:id/pause", {
    schema: {
      tags: ["Downloads"],
      summary: "Pause a download",
      description: "Pauses an active download by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Download ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await pauseDownload(id);
    return { success: true };
  });

  // Resume download
  app.post("/api/downloads/:id/resume", {
    schema: {
      tags: ["Downloads"],
      summary: "Resume a download",
      description: "Resumes a paused download by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Download ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await resumeDownload(id);
    return { success: true };
  });

  // Retry download
  app.post("/api/downloads/:id/retry", {
    schema: {
      tags: ["Downloads"],
      summary: "Retry a download",
      description: "Retries a failed download by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Download ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await retryDownload(id);
    return { success: true };
  });

  // Cancel download
  app.post("/api/downloads/:id/cancel", {
    schema: {
      tags: ["Downloads"],
      summary: "Cancel a download",
      description: "Cancels an active or queued download by its ID.",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Download ID" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await cancelDownload(id);
    return { success: true };
  });
}
