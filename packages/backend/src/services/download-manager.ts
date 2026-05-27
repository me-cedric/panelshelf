import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { downloads, downloadLinks } from "../db/schema";
import { findProviderForUrl } from "../providers/registry";
import { config } from "../config";
import fs from "node:fs";
import path from "node:path";

interface ActiveDownload {
  id: string;
  abortController: AbortController;
}

const activeDownloads = new Map<string, ActiveDownload>();
let concurrentCount = 0;
const maxConcurrent = config.maxConcurrentDownloads;

export async function enqueueDownload(downloadLinkId: string) {
  const db = getDb();
  const link = db.select().from(downloadLinks).where(eq(downloadLinks.id, downloadLinkId)).get();
  if (!link) throw new Error(`Download link not found: ${downloadLinkId}`);

  const downloadId = uuid();
  const destDir = config.downloadDir;
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const rawFileName = link.fileName || link.url.split("/").pop() || "download";
  const fileName = path.basename(rawFileName); // Prevent directory traversal
  const destPath = path.join(destDir, fileName);

  db.insert(downloads)
    .values({
      id: downloadId,
      catalogItemId: link.catalogItemId,
      downloadLinkId: link.id,
      url: link.url,
      fileName,
      destinationPath: destPath,
      status: "pending",
    })
    .run();

  // Try to start processing
  processNextInQueue();

  return downloadId;
}

function processNextInQueue() {
  if (concurrentCount >= maxConcurrent) return;

  const db = getDb();
  const next = db
    .select()
    .from(downloads)
    .where(eq(downloads.status, "pending"))
    .orderBy(downloads.createdAt)
    .limit(1)
    .get();

  if (!next) return;

  concurrentCount++;
  executeDownload(next);
}

async function executeDownload(download: typeof downloads.$inferSelect) {
  const db = getDb();
  const abortController = new AbortController();
  const active: ActiveDownload = { id: download.id, abortController };
  activeDownloads.set(download.id, active);

  try {
    // Mark as running
    db.update(downloads)
      .set({ status: "running" })
      .where(eq(downloads.id, download.id))
      .run();

    // Find appropriate provider
    const provider = findProviderForUrl(download.url);
    if (!provider) {
      throw new Error(`No provider available to download: ${download.url}`);
    }

    let prevMeasurement: { bytes: number; time: number; speed: number } | null = null;

    const result = await provider.download({
      url: download.url,
      fileName: download.fileName || undefined,
      destinationPath: download.destinationPath!,
      signal: abortController.signal,
      onProgress: (downloadedBytes, totalBytes) => {
        const progress = totalBytes ? (downloadedBytes / totalBytes) * 100 : 0;
        const speed = calculateSpeed(downloadedBytes, prevMeasurement);
        if (prevMeasurement) {
          prevMeasurement = {
            bytes: downloadedBytes,
            time: Date.now(),
            speed: speed ?? 0,
          };
        } else {
          prevMeasurement = { bytes: downloadedBytes, time: Date.now(), speed: 0 };
        }
        db.update(downloads)
          .set({
            progress: Math.round(progress * 100) / 100,
            downloadedBytes,
            totalBytes: totalBytes ?? sql`total_bytes`,
            speed,
          })
          .where(eq(downloads.id, download.id))
          .run();
      },
    });

    if (result.success) {
      db.update(downloads)
        .set({
          status: "completed",
          progress: 100,
          downloadedBytes: result.totalBytes ?? sql`downloaded_bytes`,
          totalBytes: result.totalBytes ?? sql`total_bytes`,
          completedAt: sql`(datetime('now'))`,
        })
        .where(eq(downloads.id, download.id))
        .run();
    } else {
      throw new Error(result.error || "Download failed");
    }
  } catch (err: any) {
    const current = db.select().from(downloads).where(eq(downloads.id, download.id)).get();
    const retryCount = (current?.retryCount || 0) + 1;
    const shouldRetry = retryCount < (current?.maxRetries || 3);

    db.update(downloads)
      .set({
        status: shouldRetry ? "pending" : "failed",
        errorLog: err.message,
        retryCount,
      })
      .where(eq(downloads.id, download.id))
      .run();

    if (shouldRetry) {
      // Re-queue with backoff
      setTimeout(() => processNextInQueue(), retryCount * 5000);
    }
  } finally {
    activeDownloads.delete(download.id);
    concurrentCount--;
    processNextInQueue();
  }
}

export async function getDownloads(options: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions = options.status
    ? [eq(downloads.status, options.status as any)]
    : [];

  const items = db
    .select()
    .from(downloads)
    .where(conditions.length > 0 ? (conditions[0] as any) : undefined)
    .orderBy(sql`CASE ${downloads.status}
      WHEN 'running' THEN 0
      WHEN 'pending' THEN 1
      WHEN 'paused' THEN 2
      WHEN 'failed' THEN 3
      WHEN 'completed' THEN 4
    END`, downloads.createdAt)
    .limit(options.limit || 50)
    .offset(options.offset || 0)
    .all();

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(downloads)
    .where(conditions.length > 0 ? (conditions[0] as any) : undefined)
    .get();

  return {
    items,
    total: countResult?.count || 0,
  };
}

export async function pauseDownload(id: string) {
  const active = activeDownloads.get(id);
  if (active) {
    active.abortController.abort();
  }
  const db = getDb();
  db.update(downloads)
    .set({ status: "paused" })
    .where(eq(downloads.id, id))
    .run();
}

export async function resumeDownload(id: string) {
  const db = getDb();
  db.update(downloads)
    .set({ status: "pending" })
    .where(eq(downloads.id, id))
    .run();
  processNextInQueue();
}

export async function retryDownload(id: string) {
  const db = getDb();
  db.update(downloads)
    .set({ status: "pending", retryCount: 0, errorLog: null })
    .where(eq(downloads.id, id))
    .run();
  processNextInQueue();
}

export async function cancelDownload(id: string) {
  const active = activeDownloads.get(id);
  if (active) {
    active.abortController.abort();
  }
  const db = getDb();
  db.update(downloads)
    .set({ status: "failed", errorLog: "Cancelled by user" })
    .where(eq(downloads.id, id))
    .run();
}

// Speed calculation (exponential moving average)

function calculateSpeed(bytes: number, prev: { bytes: number; time: number; speed: number } | null): number | null {
  const now = Date.now();
  if (!prev) return null;
  const dt = (now - prev.time) / 1000;
  if (dt <= 0) return prev.speed;
  const instantSpeed = (bytes - prev.bytes) / dt;
  // Exponential moving average (alpha = 0.3)
  return prev.speed === 0 ? instantSpeed : prev.speed * 0.7 + instantSpeed * 0.3;
}

export function getActiveDownloads() {
  return Array.from(activeDownloads.keys());
}
