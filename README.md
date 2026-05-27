<div align="center">
  <br />
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/frontend/public/favicon.svg">
    <img src="packages/frontend/public/favicon.svg" width="80" height="80" alt="PanelShelf logo" />
  </picture>
  <h1 align="center">PanelShelf</h1>
  <p align="center">
    <strong>Self-hosted comic & graphic novel release browser, download manager, and local library reader</strong>
  </p>
  <p align="center">
    <a href="#-overview">Overview</a> •
    <a href="#-features">Features</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-desktop-app">Desktop App</a> •
    <a href="#-development">Development</a> •
    <a href="#-api">API</a> •
    <a href="#-contributing">Contributing</a>
  </p>
  <p align="center">
    <a href="https://github.com/me-cedric/panelshelf/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
    <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20" /></a>
    <a href="#"><img src="https://img.shields.io/badge/pnpm-workspace-purple" alt="pnpm workspace" /></a>
    <a href="#"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms" />
  </p>
  <br />
</div>

PanelShelf aggregates comic book and graphic novel releases from multiple online sources into a single, searchable, filterable catalog — then helps you download and read them. It's a **self-hosted** alternative to commercial comic trackers, built for collectors who want to curate their own digital library.

<p align="center">
  <i>🖼️ Screenshots coming soon</i>
</p>

---

## ✨ Overview

PanelShelf solves a common problem for comic collectors: releases are scattered across dozens of sites (GetComics, Digital Comic Museum, Internet Archive, ZipComic, and hundreds of RSS/WordPress feeds). Manually checking each one is tedious.

- **Aggregate** — Add any comic release site as a "source" and PanelShelf indexes its catalog
- **Search** — Search across your entire indexed catalog or do live searches against source sites in real-time
- **Download** — Track download links, resolve redirect chains, and manage your download queue
- **Read** — Import your local CBZ/CBR files and read them in the built-in comic reader
- **Desktop app** — Optional Tauri v2 native wrapper with sidecar backend

> **Status**: Active development. The core features are functional, but APIs and storage format may change before v1.0.

---

## 🚀 Features

### Multi-Source Aggregation

- **Pluggable provider system** — Each comic source site gets a provider adapter that knows how to scrape it
- **Source types**: RSS/Atom feeds, WordPress sites, Digital Comic Museum, ZipComic (with Cloudflare bypass), Internet Archive, GetComics, and more
- **Auto-detection** — Paste a URL and PanelShelf detects the source type automatically
- **Per-source refresh intervals** with rate limiting
- **Dual catalog** — Persisted SQLite index (fast offline queries) + live search results from source sites

### Catalog & Search

- **Indexed catalog** — All ingested items stored in SQLite with full filtering and sorting
- **Live search** — Real-time search across source feeds and provider sites with progressive loading (stale-while-revalidate — cached results appear instantly while fresh data loads)
- **Infinite scroll** — Smooth progressive pagination with configurable trigger distance
- **Metadata extraction** — Automatically extracts cover art, publisher, format, file size, release date, series, issue number, and download links
- **Grid & table views** — Toggle between visual cover grid and compact data table
- **Filters**: publisher, series, format, language, source, download availability, date ranges
- **Sorting**: title, release date, file size, date added
- **Saved searches** — Bookmark filter/search combinations for quick access

### Download Manager

- **Pin download links** across sessions
- **Redirect chain resolution** — Follows HTTP redirects, meta-refresh, iframes, and JS redirects to find the actual file URL
- **Concurrent downloads** with progress tracking, speed, ETA, and retry logic
- **Provider labels** — See which host (Mega, MediaFire, Dropbox, etc.) each link belongs to

### Cloudflare Bypass

PanelShelf includes a multi-layer strategy for scraping Cloudflare-protected sites:

| Layer | Method | When It's Used |
|-------|--------|----------------|
| **1. curl_cffi** | TLS fingerprint impersonation (Chrome 120) | Lightweight, preferred — Docker sidecar |
| **2. Playwright** | Full headless Chromium with stealth plugin | Fallback when curl_cffi fails |
| **3. FlareSolverr** | Docker browser proxy (optional) | Last resort for stubborn sites |

### Local Library & Comic Reader

- **Add local folders** — Point PanelShelf at a directory of comics
- **Supported formats**: CBZ (native), CBR (requires `unrar`), ZIP, RAR
- **Automatic scanning** — Recursively walks directories and indexes all comic files
- **Cover caching** — Extracts cover images on first scan, cached to disk
- **Full-screen reader** with keyboard shortcuts (next/prev, zoom modes, progress tracking)
- **Reading progress** — Persisted per-item, resumed across sessions
- **Format badges** — Each comic shows its format (CBZ/CBR) in the library grid
- **Auto-scan on startup** — Optional, scans all library folders when the server starts

### Cross-Platform Desktop App

- **Tauri v2** native wrapper for macOS, Windows, and Linux
- **Standalone backend** — Backend compiled to a single binary via `@yao-pkg/pkg`, runs as a sidecar
- **Health monitoring** — Rust backend polls the API health endpoint, logs startup progress
- **Graceful shutdown** — Sidecar process is automatically killed when the desktop window closes
- **Native folder dialogs** — Use the OS directory picker for library folders

### REST API

- **Full OpenAPI documentation** at `/docs` in dev mode (powered by Scalar)
- **Dark-themed API docs** — Branded custom CSS, dark mode, interactive "Try It" for each endpoint
- All catalog operations, source management, downloads, and library operations available via API

### UI/UX

- **Dark theme** — Built with React, Tailwind CSS, and a polished dark gradient palette
- **Toast notifications** — In-app notifications for actions and errors
- **Onboarding dialog** — First-run setup guide for new users
- **Responsive layout** — Sidebar navigation, collapsible panels, hover states, and transitions

---

## 🏗️ Architecture

```
                    ┌───────────────────────────────────┐
                    │       Web Browser / Tauri WebView  │
                    │  (React + TanStack Query + Vite)   │
                    └──────────────┬────────────────────┘
                                   │ HTTP (REST API)
                    ┌──────────────▼────────────────────┐
                    │         PanelShelf Backend          │
                    │     (Fastify + TypeScript)          │
                    │                                     │
                    │  ┌─────────────────────────────┐   │
                    │  │     Provider Adapters        │   │
                    │  │  ┌─────┐ ┌────┐ ┌────────┐ │   │
                    │  │  │RSS  │ │DCM │ │ZipComic│ │   │
                    │  │  ├─────┤ ├────┤ ├────────┤ │   │
                    │  │  │Get  │ │IA  │ │Manual  │ │   │
                    │  │  │Coms │ │    │ │URL     │ │   │
                    │  │  └─────┘ └────┘ └────────┘ │   │
                    │  └─────────────────────────────┘   │
                    │             │                       │
                    │  ┌──────────▼────────────────────┐ │
                    │  │      Bypass Layer Stack        │ │
                    │  │  curl_cffi → Playwright → FS   │ │
                    │  └────────────────────────────────┘ │
                    │             │                       │
                    │  ┌──────────▼────────────────────┐ │
                    │  │      Catalog Service           │ │
                    │  │   (Drizzle ORM + SQLite)       │ │
                    │  └────────────────────────────────┘ │
                    │                                     │
                    │  ┌─────────────────────────────┐   │
                    │  │  Background Jobs (Queue)     │   │
                    │  │  Source refresh, indexing,   │   │
                    │  │  library scanning             │   │
                    │  └─────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.7, Vite 6, TanStack React Query 5, React Router 7, Tailwind CSS 3, Lucide Icons |
| **Backend** | Fastify 5, TypeScript, Drizzle ORM 0.40, better-sqlite3, Cheerio (HTML parsing), undici (HTTP), rss-parser |
| **Database** | SQLite (single file, zero configuration, portable) |
| **Desktop** | Tauri v2, Rust (tauri-plugin-shell, tauri-plugin-dialog) |
| **Package Manager** | pnpm workspaces (monorepo) |
| **CI** | (Coming soon — GitHub Actions) |
| **Auth** | (Coming soon — JWT/Keycloak planned) |

### Project Structure

```
panelshelf/
├── packages/
│   ├── frontend/                # React web application
│   │   ├── src/
│   │   │   ├── api/             # API client functions & validation
│   │   │   ├── components/      # React components (13+ components)
│   │   │   ├── hooks/           # Custom React hooks
│   │   │   ├── types/           # TypeScript type definitions
│   │   │   ├── constants/       # App constants
│   │   │   ├── utils/           # Utility functions
│   │   │   ├── App.tsx          # Root app with router
│   │   │   └── main.tsx         # Entry point
│   │   └── public/              # Static assets (favicon)
│   ├── backend/                 # Fastify API server
│   │   ├── src/
│   │   │   ├── db/              # Drizzle schema, migrations, DB init
│   │   │   ├── providers/       # 6+ provider adapters (scrapers)
│   │   │   ├── routes/          # 7 route modules (catalog, sources, etc.)
│   │   │   ├── services/        # Business logic (catalog, library scanner)
│   │   │   ├── queue/           # Background job processing
│   │   │   ├── config.ts        # Environment config
│   │   │   └── index.ts         # Server bootstrap
│   │   ├── sidecar/             # Python curl_cffi sidecar
│   │   └── data/                # SQLite DB & downloads (gitignored)
│   └── desktop/                 # Tauri v2 desktop wrapper (optional)
│       ├── src-tauri/
│       │   ├── src/main.rs      # Sidecar lifecycle, health polling
│       │   ├── binaries/        # Compiled backend placeholder
│       │   ├── capabilities/    # Tauri v2 permissions
│       │   └── icons/           # App icons
│       └── scripts/             # Icon & backend build scripts
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # Full stack with sidecar services
├── package.json                 # Root scripts & workspace config
└── pnpm-workspace.yaml          # pnpm workspace definition
```

### In-Memory Caching

The backend maintains three in-memory caches for live search performance:

| Cache | TTL | Purpose |
|-------|-----|---------|
| Feed URL cache | 1 hour | Resolved RSS/Atom feed URLs per source |
| Search results cache | 10 min | Scraped WP page results per query/page |
| Total pages cache | 10 min | Detected pagination count per source |

All caches can be cleared via Settings → Sources → **Clear Cache**, or `POST /api/cache/clear`.

---

## 🏁 Quick Start

### Prerequisites

- **Node.js** >= 20 (LTS recommended)
- **pnpm** >= 9 (install: `npm install -g pnpm`)
- **Rust** (only for desktop app: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

### Installation

```bash
# Clone the repository (or download the source)
git clone https://github.com/me-cedric/panelshelf.git
cd panelshelf

# Install all dependencies
pnpm install

# Run database migrations (creates SQLite DB)
pnpm run db:migrate

# Start development servers (API + frontend concurrently)
pnpm dev
```

The API starts at **http://localhost:3001** and the frontend at **http://localhost:5173**.

Open `http://localhost:5173` in your browser. The Vite dev server proxies `/api` requests to the backend.

### Docker Quick Start

```bash
# Build and start with Docker Compose (includes curl_cffi sidecar)
docker compose up -d

# Migrations run automatically on startup
# Open http://localhost:3001
```

### First-Time Setup

1. Open the app in your browser
2. Navigate to **Sources** (sidebar)
3. Click **Add Source** to add a content source

**Example: GetComics RSS feed**
```
Name: GetComics
Type: RSS
Base URL: https://getcomics.org
```

Click **Create Source**, then click the **Refresh** button on the source row. The backend fetches and indexes comics from the source.

4. Navigate to **Catalog** to browse indexed results and use live search.

> **Tip**: Click the **Detect** button next to the URL field to auto-detect the source type from a URL.

### Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `DATA_DIR` | `./data` | Directory for SQLite DB, cache, and downloads |
| `DOWNLOAD_DIR` | `./data/downloads` | Download destination |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Max simultaneous downloads |
| `DEFAULT_REFRESH_INTERVAL_MIN` | `60` | Default source refresh interval (minutes) |
| `AUTO_SCAN_ON_START` | `false` | Auto-scan library sources on server start |
| `CURL_CFFI_URL` | — | curl_cffi sidecar endpoint for Cloudflare bypass |
| `FLARESOLVERR_URL` | — | FlareSolverr endpoint (alternative bypass) |
| `LOG_LEVEL` | `info` | Pino log level (trace/debug/info/warn/error/fatal) |
| `NODE_ENV` | `development` | Set to `production` for production mode |

---

## 📖 Comic Reader

PanelShelf includes a full-featured comic reader for browsing and reading your local collection directly in the browser or desktop app.

### Supported Formats

| Format | Extension | Backend |
|--------|-----------|---------|
| **CBZ** (ZIP-compressed) | `.cbz`, `.zip` | `adm-zip` (native) |
| **CBR** (RAR-compressed) | `.cbr`, `.rar` | `unrar` or `unar` (system CLI) |
| **PDF** | `.pdf` | Planned (see roadmap) |

> **Note**: For CBR/RAR support, install `unrar` (macOS: `brew install unrar`, Ubuntu: `sudo apt install unrar`, Windows: download from [rarlab.com](https://www.rarlab.com/)) or `unar` (`brew install unar` / `sudo apt install unar`).

### Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Next page | `→` / `Space` |
| Previous page | `←` |
| First page | `Home` |
| Last page | `End` |
| Fit to width | `F` (cycles: width → height → original) |
| Original size | `Z` |
| Toggle shortcuts | `?` |
| Exit reader | `Esc` |

Reading progress is saved automatically between sessions. Finished comics show a green checkmark badge.

---

## 🖥️ Desktop App

PanelShelf includes an optional **Tauri v2** desktop wrapper that packages the web app as a native desktop application.

### Architecture

The desktop app bundles:
- **Frontend** — Built static files served by Tauri's webview
- **Backend** — Compiled to a standalone binary (`@yao-pkg/pkg`), runs as a sidecar process
- **Tauri** — Rust wrapper that spawns the backend, monitors its health via `/api/health`, and kills it on window close

### Building

```bash
cd packages/desktop

# Generate app icons from the SVG favicon
pnpm run icon

# Development mode (uses tsx for backend, hot-reloads frontend)
pnpm run tauri:dev

# Production build (compiles backend, builds frontend, packages .dmg/.msi/.AppImage)
pnpm run tauri:build
```

### Platform Build Dependencies

| Platform | Requirements |
|----------|-------------|
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev` |
| **Windows** | Microsoft Visual Studio C++ Build Tools |

### Known Limitations

- The `@yao-pkg/pkg` bundler may not fully support `better-sqlite3`'s native module. If the production build fails, use Docker-based distribution or try Bun's `--compile` option.

---

## 🐳 Docker Deployment

The included `Dockerfile` uses a multi-stage build:
1. **Frontend builder** — Installs deps, builds Vite output
2. **Backend builder** — Installs deps, compiles TypeScript
3. **Runtime** — Minimal `node:20-alpine` with `dumb-init`, production deps only

Run with Docker Compose:

```bash
docker compose up -d
# Open http://localhost:3001
```

The Compose file also includes:
- **curl-cffi-sidecar** — Python-based TLS fingerprint bypass (enabled by default)
- **FlareSolverr** — Optional full-browser proxy (commented out — uncomment to enable)

---

## 💻 Development

### Commands

```bash
# Start dev servers (API + frontend concurrently)
pnpm dev

# Type-check all packages
pnpm run typecheck

# Build all packages (backend + frontend)
pnpm run build

# Run database migrations
pnpm run db:migrate

# Generate Drizzle migrations (after schema changes)
pnpm --filter @panelshelf/backend run db:generate

# Push schema changes directly (dev only — SQLite)
pnpm --filter @panelshelf/backend run db:push

# Desktop development
pnpm run dev:desktop

# Desktop production build
pnpm run build:desktop
```

### Adding a New Provider

Provider adapters follow the `ProviderAdapter` interface in `packages/backend/src/providers/types.ts`:

```typescript
interface ProviderAdapter {
  id: string;
  name: string;
  canHandle(url: string): boolean;
  inspect(url: string, options?: ProviderInspectOptions): Promise<ProviderInspectionResult>;
  download(request: DownloadRequest): Promise<DownloadResult>;
}
```

To add a new provider:

1. Create `packages/backend/src/providers/<name>/index.ts`
2. Implement `ProviderAdapter`
3. Register it in `packages/backend/src/index.ts` via `registerProvider()`
4. Optionally add auto-detection logic in `packages/backend/src/routes/sources.ts`

### curl_cffi Sidecar (for Cloudflare protection)

If you don't want to use Docker, run the Python sidecar locally:

```bash
cd packages/backend/sidecar
pip install -r requirements.txt
python3 server.py

# Then set: CURL_CFFI_URL=http://localhost:8192/fetch
```

---

## 📡 API

PanelShelf exposes a REST API at `http://localhost:3001/api`. In dev mode, interactive API documentation is available at `http://localhost:3001/docs` (branded dark theme).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| **System** |||
| `GET` | `/api/health` | Health check (status, version, uptime) |
| `GET` | `/api/stats` | Catalog stats (total items, sources, downloads) |
| `GET` | `/api/settings` | Get application settings |
| `POST` | `/api/settings` | Update application settings |
| **Catalog** |||
| `GET` | `/api/catalog` | List/search indexed catalog items |
| `GET` | `/api/catalog/:id` | Get single item with download links |
| `GET` | `/api/catalog/filters/:column` | Get distinct filter values |
| `GET` | `/api/catalog/live-search` | Live search across source feeds |
| `GET` | `/api/catalog/live-search/categories` | List provider categories (e.g., DCM publishers) |
| `GET` | `/api/catalog/live-detail` | Scrape download links from a detail page |
| `GET` | `/api/catalog/resolve-download` | Resolve a download URL through redirects |
| **Sources** |||
| `GET` | `/api/sources` | List configured sources |
| `POST` | `/api/sources` | Create a source |
| `PUT` | `/api/sources/:id` | Update a source |
| `DELETE` | `/api/sources/:id` | Delete a source |
| `POST` | `/api/sources/:id/refresh` | Trigger source refresh |
| `POST` | `/api/sources/auto-detect` | Auto-detect source type from URL |
| `GET` | `/api/sources/types` | List available source types |
| **Downloads** |||
| `GET` | `/api/downloads` | List downloads |
| `POST` | `/api/downloads` | Enqueue a download |
| **Saved Searches** |||
| `GET` | `/api/saved-searches` | List saved searches |
| `POST` | `/api/saved-searches` | Save a search |
| `DELETE` | `/api/saved-searches/:id` | Delete a saved search |
| **Cache** |||
| `POST` | `/api/cache/clear` | Clear all in-memory provider caches |
| **Library** |||
| `GET` | `/api/library/sources` | List library sources (folders) |
| `POST` | `/api/library/sources` | Add a library folder |
| `DELETE` | `/api/library/sources/:id` | Remove a library folder |
| `POST` | `/api/library/sources/:id/scan` | Scan a library folder for comics |
| `GET` | `/api/library/items` | List library items with search/filter |
| `GET` | `/api/library/items/:id/page/:page` | Get a single page image |
| `GET` | `/api/library/items/:id/cover` | Get cover image |
| `POST` | `/api/library/scan-all` | Scan all library sources |
| **Providers** |||
| `GET` | `/api/providers` | List registered providers |

### Live Search Example

```bash
# Browse all posts from an RSS source
curl "http://localhost:3001/api/catalog/live-search?sourceId=<source-id>&page=1"

# Search with term
curl "http://localhost:3001/api/catalog/live-search?sourceId=<source-id>&q=batman&page=1"

# Fresh data (bypass cache)
curl "http://localhost:3001/api/catalog/live-search?sourceId=<source-id>&q=batman&fresh=true"
```

---

## 🧪 Testing

```bash
# Type-check all packages
pnpm run typecheck

# Run backend type-check
pnpm --filter @panelshelf/backend run typecheck

# Run frontend type-check
pnpm --filter @panelshelf/frontend run typecheck
```

> Unit test infrastructure is planned. Contributions welcome!

---

## 🤝 Contributing

Contributions are welcome! Here's how to help:

### Bug Reports & Feature Requests

- Open a [GitHub Issue](https://github.com/me-cedric/panelshelf/issues/new)
- Include steps to reproduce for bugs
- Describe the use case for feature requests

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Run `pnpm run typecheck` to verify no type errors
5. Commit (`git commit -m 'feat: add amazing feature'`)
6. Push to your fork (`git push origin feat/amazing-feature`)
7. Open a Pull Request

### Guidelines

- Follow the existing code style and architecture patterns
- Provider adapters go behind the existing `ProviderAdapter` interface
- Run `pnpm run typecheck` before committing
- Update this README if adding significant features
- Use Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`, etc.)

### Development Setup

See the [Development](#-development) section above. The project uses a standard pnpm monorepo — install, migrate, and run.

---

## 🗺️ Roadmap

- [ ] **Unit & integration tests** (Vitest for frontend, Node Test Runner for backend)
- [ ] **GitHub Actions CI** — Type-check, lint, test on PRs
- [ ] **JWT / Keycloak authentication**
- [ ] **User account management** with per-user libraries
- [ ] **PDF comic support** in the reader
- [ ] **OPDS feed** for external reader apps (e.g., Chunky, YACReader)
- [ ] **WebSocket push** for real-time download progress
- [ ] **Docker Compose health checks** for all services
- [x] **Comic reader** — Full-screen page viewer
- [x] **Desktop app** — Tauri v2 native wrapper
- [x] **Cloudflare bypass** — curl_cffi + Playwright + FlareSolverr
- [x] **Library management** — Local folder scanning
- [x] **Download manager** — Queue, progress, redirect resolution
- [x] **Multi-source aggregation** — RSS, DCM, IA, ZipComic, GetComics

---

## 📜 License

Distributed under the **MIT License**. See [LICENSE](./LICENSE) for more information.

---

## 🙏 Acknowledgments

- [GetComics](https://getcomics.org) — Primary comic release aggregator
- [Digital Comic Museum](https://digitalcomicmuseum.com) — Public domain comic archive
- [Internet Archive](https://archive.org) — Digital library
- [ZipComic](https://zipcomic.com) — Comic download portal
- Built with [Fastify](https://fastify.dev), [React](https://react.dev), [Tauri](https://tauri.app), [Drizzle](https://orm.drizzle.team), and many other open-source libraries

---

<div align="center">
  <p>
    <a href="https://github.com/me-cedric/panelshelf">GitHub</a> •
    <a href="#-overview">Docs</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-contributing">Contributing</a>
  </p>
  <p>
    <sub>Built with ❤️ and TypeScript, Rust, and Python</sub>
  </p>
</div>
