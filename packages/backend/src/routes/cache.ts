import type { FastifyInstance } from "fastify";
import { clearAllCaches } from "./catalog";

export function cacheRoutes(app: FastifyInstance) {
  app.post("/api/cache/clear", {
    schema: {
      tags: ["Cache"],
      summary: "Clear all caches",
      description: "Clears all in-memory caches including feed URL cache, search results, and total pages cache.",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    clearAllCaches();
    return { success: true, message: "All provider caches cleared" };
  });
}
