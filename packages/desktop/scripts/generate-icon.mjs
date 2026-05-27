/**
 * Generate a high-res PNG app icon from the existing SVG favicon.
 * Uses sharp to render the SVG at 1024x1024.
 *
 * Usage: node scripts/generate-icon.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FAVICON_PATH = path.resolve(ROOT, "..", "frontend", "public", "favicon.svg");
const OUTPUT_PNG = path.resolve(ROOT, "src-tauri", "icons", "app-icon.png");

async function main() {
  if (!existsSync(FAVICON_PATH)) {
    console.error("Favicon SVG not found at", FAVICON_PATH);
    process.exit(1);
  }

  // Try to use sharp if available
  try {
    const sharp = createRequire(import.meta.url)("sharp");
    const svgBuffer = readFileSync(FAVICON_PATH);

    await sharp(svgBuffer)
      .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(OUTPUT_PNG);

    console.log(`Icon generated: ${OUTPUT_PNG} (1024x1024 PNG)`);
  } catch (err) {
    console.error(
      "Failed to generate icon with sharp. Install it: pnpm --filter @panelshelf/desktop add sharp -D"
    );
    console.error(err);
    process.exit(1);
  }
}

main();
