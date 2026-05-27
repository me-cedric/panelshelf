# Changelog

All notable changes to PanelShelf will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-27

### Added

- **Multi-source aggregation** — Index comics from RSS/Atom feeds, WordPress sites, Digital Comic Museum, ZipComic, Internet Archive, GetComics, and more via a pluggable provider system
- **Live search** — Real-time search across RSS feeds and provider sites with progressive (stale-while-revalidate) loading — cached results appear instantly while fresh data loads in the background
- **Infinite scroll** — Smooth progressive pagination with configurable trigger distance and page size
- **Metadata extraction** — Automatically extracts cover art, publisher, format, file size, release date, series, issue number, and download links
- **Dual catalog** — Indexed catalog (persisted in SQLite for fast offline access) alongside live search results from source sites
- **Source management** — Add, edit, enable/disable, and refresh sources with configurable refresh intervals and rate limiting
- **Download manager** — Track download links, pin links across sessions, resolve redirect chains, and manage download history
- **Saved searches** — Save filter/search combinations for quick access
- **Filtering & sorting** — Filter by publisher, series, format, language, source, download availability, and date ranges. Sort by title, release date, file size, or date added
- **Grid & table views** — Toggle between visual cover grid and compact table layout
- **Library management** — Add local folders, scan CBZ/CBR/ZIP/RAR archives, with cover caching and format badges
- **Comic reader** — Full-screen page viewer with keyboard shortcuts, zoom modes, and persistent reading progress tracking
- **Cloudflare bypass stack** — Multi-layer approach: curl_cffi (TLS fingerprint) → Playwright (headless browser) → FlareSolverr (optional Docker proxy)
- **Cross-platform desktop app** — Optional Tauri v2 wrapper for Windows, macOS, and Linux with a compiled standalone backend binary, health monitoring, and graceful shutdown
- **REST API** — Full OpenAPI-documented API at `/docs` (dev mode) with branded dark theme
- **Docker deployment** — Multi-stage Dockerfile + docker-compose.yml with curl_cffi sidecar
- **Dark theme UI** — Built with React 19, Tailwind CSS, TanStack React Query, and Lucide Icons
- **In-memory caching** — Feed URL cache (1h TTL), search results cache (10min TTL), total pages cache (10min TTL) for live search performance
- **Background job queue** — Source refresh, catalog indexing, library scanning via simple queue system

### Technical

- **Monorepo** — pnpm workspaces with three packages: `frontend`, `backend`, `desktop`
- **Backend** — Fastify 5 + TypeScript + Drizzle ORM + better-sqlite3
- **Frontend** — React 19 + TypeScript + Vite + TanStack Query 5 + React Router 7
- **Desktop** — Tauri v2 + Rust (tauri-plugin-shell, tauri-plugin-dialog)
- **Database** — SQLite (single-file, zero-config, portable)
- **Sidecar** — Python curl_cffi FastAPI server for TLS fingerprint impersonation
- **API docs** — Scalar API Reference with custom dark theme CSS
