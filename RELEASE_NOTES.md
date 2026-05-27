# PanelShelf v0.1.0

Self-hosted comic & graphic novel release browser, download manager, and local library reader.

## What's New

- **Multi-source aggregation** — RSS feeds, DCM, ZipComic, Internet Archive, GetComics
- **Interactive catalog** — live search, infinite scroll, publisher/source/tag filters
- **Download manager** — queue-based with redirect resolution and progress tracking
- **Cloudflare bypass stack** — curl_cffi sidecar with stealth Playwright fallback
- **Local library scanner** — auto-import CBZ/CBR files with metadata extraction
- **Comic reader** — full-screen reader with keyboard shortcuts and page controls
- **Desktop app** — Tauri v2 wrapper (macOS, Linux, Windows)
- **OpenAPI docs** — auto-generated API reference at `/docs`
- **Docker deployment** — single `docker compose up -d` to run everything

## Artifacts

| File | Size | Description |
|------|------|-------------|
| `panelshelf-v0.1.0.tar.gz` | 23 MB | Pre-built backend + frontend archive |
| `panelshelf-v0.1.0.zip` | 23 MB | Pre-built backend + frontend archive |
| `ghcr.io/me-cedric/panelshelf:v0.1.0` | — | Docker image (multi-arch) |

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
# Open http://localhost:3001
```

### Manual

```bash
git clone https://github.com/me-cedric/panelshelf.git
cd panelshelf
pnpm install
pnpm run db:migrate
pnpm run dev
# Open http://localhost:5173
```

## Supported Sources

| Source | Type | RSS | Search |
|--------|------|-----|--------|
| GetComics | Web scraping | — | ✅ |
| DCM (Digital Comic Museum) | Structured | ✅ | ✅ |
| ZipComic | Structured | ✅ | ✅ |
| Internet Archive | Structured | — | ✅ |
| Generic RSS/Atom | Feed parsing | ✅ | — |

## Known Limitations

- Desktop app: Tauri build requires Rust toolchain (see README for per-platform instructions)
- Internet Archive covers may be slow to load due to IA image server rate limits
- Cloudflare bypass may require periodic captcha solving on first visit

## Changelog

See [CHANGELOG.md](https://github.com/me-cedric/panelshelf/blob/main/CHANGELOG.md) for the full changelog.
