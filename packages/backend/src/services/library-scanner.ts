import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { librarySources, libraryItems, readingProgress } from "../db/schema";

const COMIC_EXTENSIONS = new Set([".cbr", ".cbz", ".pdf", ".zip", ".rar"]);

/**
 * Scan a library source directory for comic files.
 * Recursively walks the directory and finds all files with known comic extensions.
 * Returns stats about what was found, added, and skipped.
 */
export async function scanLibrarySource(
  sourceId: string
): Promise<{ added: number; skipped: number; total: number; errors: string[] }> {
  const db = getDb();
  const source = db
    .select()
    .from(librarySources)
    .where(eq(librarySources.id, sourceId))
    .get();

  if (!source) throw new Error(`Library source not found: ${sourceId}`);
  if (!fs.existsSync(source.path)) throw new Error(`Directory not found: ${source.path}`);

  const errors: string[] = [];
  let added = 0;
  let skipped = 0;
  const foundFiles: string[] = [];
  const scanRecursive = source.scanRecursive;
  const sourcePath = source.path;

  // Walk the directory
  function walkDir(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && scanRecursive) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (COMIC_EXTENSIONS.has(ext)) {
            foundFiles.push(fullPath);
          }
        }
      }
    } catch (err: any) {
      errors.push(`Error reading ${dir}: ${err.message}`);
    }
  }

  walkDir(sourcePath);

  // No comic files found — skip DB work entirely
  if (foundFiles.length === 0) {
    return { added: 0, skipped: 0, total: 0, errors: [] };
  }

  // Process found files
  for (const filePath of foundFiles) {
    try {
      const stats = fs.statSync(filePath);
      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase();
      const format = ext.replace(".", "").toUpperCase();

      // Generate a title from filename (strip extension, replace dots/underscores with spaces)
      const title = path
        .parse(fileName)
        .name.replace(/[._]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Check if this file path already exists
      const existing = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.filePath, filePath))
        .get();

      if (existing) {
        // Update metadata in case file changed
        db.update(libraryItems)
          .set({
            fileSizeBytes: stats.size,
            pageCount: existing.pageCount, // preserve existing page count
            title: existing.title,
          })
          .where(eq(libraryItems.id, existing.id))
          .run();
        skipped++;
      } else {
        // Insert new item
        db.insert(libraryItems)
          .values({
            id: uuid(),
            librarySourceId: sourceId,
            title,
            fileName,
            filePath,
            format,
            fileSizeBytes: stats.size,
            pageCount: null, // will be populated on first read
          })
          .run();
        added++;
      }
    } catch (err: any) {
      errors.push(`Error processing ${filePath}: ${err.message}`);
    }
  }

  // Update source metadata
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(libraryItems)
    .where(eq(libraryItems.librarySourceId, sourceId))
    .get();

  db.update(librarySources)
    .set({
      itemCount: count?.count || 0,
      lastScannedAt: sql`(datetime('now'))`,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(librarySources.id, sourceId))
    .run();

  return { added, skipped, total: foundFiles.length, errors };
}

/**
 * Scan all enabled library sources.
 */
export async function scanAllSources(): Promise<{
  results: Array<{ sourceId: string; name: string; added: number; skipped: number; errors: string[] }>;
}> {
  const db = getDb();
  const sources = db
    .select()
    .from(librarySources)
    .where(eq(librarySources.enabled, true))
    .all();

  const results = [];
  for (const source of sources) {
    try {
      const result = await scanLibrarySource(source.id);
      results.push({
        sourceId: source.id,
        name: source.name,
        ...result,
      });
    } catch (err: any) {
      results.push({
        sourceId: source.id,
        name: source.name,
        added: 0,
        skipped: 0,
        errors: [err.message],
      });
    }
  }

  return { results };
}

/**
 * Get the cover image page (page 1) from a comic archive.
 * Returns the page image as a Buffer, or null if not available.
 */
export async function extractCoverPage(
  filePath: string,
  format: string
): Promise<Buffer | null> {
  try {
    const pages = await extractPages(filePath, format, 1, 1);
    return pages[0] || null;
  } catch {
    return null;
  }
}

/**
 * Extract specific pages from a comic archive.
 * Returns an array of image Buffers.
 */
export async function extractPages(
  filePath: string,
  format: string,
  startPage: number,
  count: number
): Promise<Buffer[]> {
  if (format === "CBZ" || format === "ZIP") {
    return extractPagesFromZip(filePath, startPage, count);
  }
  if (format === "CBR" || format === "RAR") {
    return extractPagesFromRar(filePath, startPage, count);
  }
  throw new Error(`Unsupported format: ${format}`);
}

/**
 * Extract pages from a CBZ (ZIP) archive.
 * Images inside the ZIP are sorted alphabetically by filename.
 */
async function extractPagesFromZip(
  filePath: string,
  startPage: number,
  count: number
): Promise<Buffer[]> {
  // Use adm-zip for ZIP extraction (dynamically imported for ESM compatibility)
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries()
    .filter((e: any) => !e.isDirectory && isImageFile(e.entryName))
    .sort((a: any, b: any) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  const results: Buffer[] = [];
  const startIdx = startPage - 1;
  const endIdx = Math.min(startIdx + count, entries.length);

  for (let i = startIdx; i < endIdx; i++) {
    results.push(entries[i].getData());
  }

  return results;
}

/**
 * Extract pages from a CBR (RAR) archive.
 * Uses unrar CLI via shell. Requires `unrar` or `unar` to be installed.
 */
async function extractPagesFromRar(
  filePath: string,
  startPage: number,
  count: number
): Promise<Buffer[]> {
  // Use unrar CLI to extract to temp directory
  const tmpDir = path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "tmp",
    uuid()
  );
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Try unrar first, fall back to unar
    const unrarCmd = `unrar e -y "${filePath}" "${tmpDir}/"`;
    let extracted = false;
    try {
      execSync(unrarCmd, { stdio: "pipe", timeout: 30000 });
      extracted = true;
    } catch {
      try {
        execSync(`unar -o "${tmpDir}" "${filePath}"`, { stdio: "pipe", timeout: 30000 });
        extracted = true;
      } catch {
        throw new Error("Neither unrar nor unar found. Install one to read CBR files.");
      }
    }

    if (!extracted) {
      throw new Error("Failed to extract RAR archive");
    }

    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => isImageFile(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const results: Buffer[] = [];
    const startIdx = startPage - 1;
    const endIdx = Math.min(startIdx + count, files.length);

    for (let i = startIdx; i < endIdx; i++) {
      results.push(fs.readFileSync(path.join(tmpDir, files[i])));
    }

    return results;
  } finally {
    // Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Check if a filename has an image extension. */
function isImageFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"].includes(ext);
}
