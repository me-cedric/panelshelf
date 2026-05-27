/**
 * Build the PanelShelf backend as a standalone binary for the Tauri sidecar.
 *
 * Steps:
 * 1. Build the backend TypeScript to JS (tsc)
 * 2. Bundle with esbuild into a single ESM file (tree-shaking + deps inlined)
 * 3. Stage a minimal directory with the bundle + native modules
 * 4. Compile with Hakobu into a standalone executable
 * 5. Rename and place it in src-tauri/binaries/ with the target-triple suffix
 *
 * Usage: node scripts/build-backend.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(ROOT, "..", "..");
const BACKEND_DIR = path.resolve(PROJECT_ROOT, "packages", "backend");
const BINARIES_DIR = path.resolve(ROOT, "src-tauri", "binaries");
const STAGE_DIR = path.resolve(BACKEND_DIR, ".hakobu-stage");

/**
 * Get the Rust target triple for the current platform.
 */
function getTargetTriple(osPlatform = os.platform(), osArch = os.arch()) {
  const archMap = { x64: "x86_64", arm64: "aarch64" };
  const arch = archMap[osArch] || osArch;
  switch (osPlatform) {
    case "darwin": return `${arch}-apple-darwin`;
    case "win32": return `${arch}-pc-windows-msvc`;
    case "linux": return `${arch}-unknown-linux-gnu`;
    default: throw new Error(`Unsupported platform: ${osPlatform}`);
  }
}

/**
 * Get the Hakobu target for the current platform.
 */
function getHakobuTarget(osPlatform = os.platform(), osArch = os.arch()) {
  const archMap = { x64: "x64", arm64: "arm64" };
  const arch = archMap[osArch] || osArch;
  switch (osPlatform) {
    case "darwin": return `node24-macos-${arch}`;
    case "win32": return `node24-win-${arch}`;
    case "linux": return `node24-linux-${arch}`;
    default: throw new Error(`Unsupported platform: ${osPlatform}`);
  }
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

async function main() {
  const targetTriple = getTargetTriple();
  const hakobuTarget = getHakobuTarget();
  const isWin = os.platform() === "win32";

  console.log(`\n[build:backend] Platform: ${os.platform()} ${os.arch()}`);
  console.log(`[build:backend] Target triple: ${targetTriple}`);
  console.log(`[build:backend] Hakobu target: ${hakobuTarget}`);

  // ── Step 1: Build TypeScript ──────────────────────────────────────────
  console.log("\n[build:backend] Step 1: Compiling TypeScript...");
  run("pnpm run build", { cwd: BACKEND_DIR });

  const distEntry = path.resolve(BACKEND_DIR, "dist", "index.js");
  if (!fs.existsSync(distEntry)) {
    console.error(`[build:backend] Backend entry not found at ${distEntry}`);
    process.exit(1);
  }

  // ── Step 2: Bundle with esbuild ───────────────────────────────────────
  // esbuild bundles all JS dependencies into a single file, avoiding the
  // pnpm symlink problem entirely. Native modules (better-sqlite3) are
  // marked as external — their .node files are copied into the stage dir.
  console.log("\n[build:backend] Step 2: Bundling with esbuild...");
  const bundleDir = path.resolve(STAGE_DIR, "dist");
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  // Write a banner file that injects require() via createRequire.
  // esbuild's ESM wrapper needs require() but Hakobu's ESM-only snapshot
  // doesn't provide it. This banner defines it before the bundle runs.
  // We write the banner to a temp file and use --banner:js with the content
  // inline (single-quoted to prevent shell interpretation of parentheses).
  const bannerContent = `import{createRequire as __cr}from"module";var require=__cr(import.meta.url);`;
  const bannerFile = path.resolve(STAGE_DIR, ".esbuild-banner.js");
  fs.writeFileSync(bannerFile, bannerContent + "\n");

  const esbuildCmd = [
    `npx esbuild "${distEntry}"`,
    `--bundle`,
    `--platform=node`,
    `--target=node24`,
    `--format=esm`,
    `--outfile="${bundleDir}/index.js"`,
    `--external:better-sqlite3`,
    `--external:*.node`,
    `--banner:js='${bannerContent}'`,
  ].join(" ");
  run(esbuildCmd, { cwd: BACKEND_DIR });

  console.log(`[build:backend] Bundle written to ${bundleDir}/index.js`);

  // ── Step 3: Stage native modules ──────────────────────────────────────
  console.log("\n[build:backend] Step 3: Staging native modules...");

  // Write a minimal package.json for the stage dir
  fs.writeFileSync(
    path.resolve(STAGE_DIR, "package.json"),
    JSON.stringify({ name: "panelshelf-backend", type: "module", private: true }),
  );

  // Copy better-sqlite3 and its transitive deps from the existing pnpm store.
  // These are already compiled (including the native .node file).
  // We copy real files (dereference symlinks) so Hakobu can snapshot them.
  console.log("\n[build:backend] Step 3a: Copying native modules from pnpm store...");
  const pnpmStore = path.resolve(PROJECT_ROOT, "node_modules", ".pnpm");

  // Find the exact version of better-sqlite3 installed in the pnpm store
  let bsqlStoreDir = null;
  for (const entry of fs.readdirSync(pnpmStore, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("better-sqlite3@")) {
      bsqlStoreDir = path.resolve(pnpmStore, entry.name, "node_modules", "better-sqlite3");
      break;
    }
  }
  if (!bsqlStoreDir || !fs.existsSync(bsqlStoreDir)) {
    console.error("[build:backend] better-sqlite3 not found in pnpm store");
    process.exit(1);
  }

  const nodeFile = path.resolve(bsqlStoreDir, "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(nodeFile)) {
    console.error(`[build:backend] .node file not found: ${nodeFile}`);
    process.exit(1);
  }
  console.log(`[build:backend] Found better-sqlite3 in pnpm store: ${bsqlStoreDir}`);
  console.log(`[build:backend] Native .node: ${nodeFile}`);

  // Copy better-sqlite3 and its direct deps (bindings, file-uri-to-path)
  // from the pnpm store — these are already compiled with real native binaries.
  const depsToStage = ["better-sqlite3", "bindings", "file-uri-to-path"];
  const stageNodeModules = path.resolve(STAGE_DIR, "node_modules");

  for (const dep of depsToStage) {
    // Find the dep in the pnpm store
    let depStoreDir = null;
    for (const entry of fs.readdirSync(pnpmStore, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`${dep}@`)) {
        depStoreDir = path.resolve(pnpmStore, entry.name, "node_modules", dep);
        break;
      }
    }
    if (!depStoreDir || !fs.existsSync(depStoreDir)) {
      console.warn(`[build:backend] Warning: ${dep} not found in pnpm store, skipping`);
      continue;
    }

    const depStagePath = path.resolve(stageNodeModules, dep);
    fs.mkdirSync(path.dirname(depStagePath), { recursive: true });
    // dereference: true follows symlinks — copies the actual file content
    fs.cpSync(depStoreDir, depStagePath, { recursive: true, dereference: true });
    console.log(`[build:backend] Copied ${dep} to stage`);
  }

  // ── Step 4: Compile with Hakobu ───────────────────────────────────────
  console.log("\n[build:backend] Step 4: Compiling with Hakobu...");

  fs.mkdirSync(BINARIES_DIR, { recursive: true });
  const binaryOutputName = "panelshelf-backend";
  const binaryOutput = path.resolve(BINARIES_DIR, binaryOutputName);

  // Hakobu runs from the stage directory. All dependencies are either
  // bundled into dist/index.js or present as real files in node_modules/.
  const hakobuCmd = `npx @hakobu/hakobu . --entry dist/index.js --target ${hakobuTarget} --output ${binaryOutput}`;
  run(hakobuCmd, { cwd: STAGE_DIR });

  // ── Step 5: Rename with target-triple suffix ──────────────────────────
  console.log("\n[build:backend] Step 5: Renaming binary for sidecar...");
  const sourceBinary = isWin ? `${binaryOutput}.exe` : binaryOutput;
  const destName = isWin
    ? `panelshelf-backend-${targetTriple}.exe`
    : `panelshelf-backend-${targetTriple}`;
  const destBinary = path.resolve(BINARIES_DIR, destName);

  if (!fs.existsSync(sourceBinary)) {
    console.error(`[build:backend] Hakobu output not found at ${sourceBinary}`);
    process.exit(1);
  }

  fs.renameSync(sourceBinary, destBinary);
  console.log(`[build:backend] Binary placed at: ${destBinary}`);

  if (!isWin) {
    execSync(`chmod +x "${destBinary}"`);
  }

  console.log("\n[build:backend] Done! Backend sidecar binary ready.");
  console.log(`[build:backend] File: ${destBinary}`);
}

main().catch((err) => {
  console.error("[build:backend] Failed:", err);
  process.exit(1);
});
