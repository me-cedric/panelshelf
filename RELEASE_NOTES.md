# PanelShelf v0.1.0

**Self-hosted comic & graphic novel release browser, download manager, and local library reader.**

This is the initial public release of PanelShelf. It aggregates comic book releases from multiple online sources, provides a searchable catalog, manages downloads, and includes a built-in comic reader for local files.

## What's Included

This release includes pre-built artifacts for easy deployment:

| Artifact | Description |
|----------|-------------|
| **Source code** (auto) | Tagged source at `v0.1.0` |
| **Docker image** | `ghcr.io/me-cedric/panelshelf:v0.1.0` (via GitHub Actions) |
| **panelshelf-v0.1.0.tar.gz** | Pre-built backend + frontend + deployment files |
| **panelshelf-v0.1.0.zip** | Same as above in ZIP format |

## Quick Start

### Using Docker (recommended)

```bash
docker compose up -d
# Open http://localhost:3001
```

The Docker Compose stack includes:
- PanelShelf web app on port 3001
- curl_cffi sidecar for Cloudflare bypass

### Manual Setup

```bash
# Requirements: Node.js >= 20, pnpm >= 9
pnpm install --prod
pnpm run db:migrate
pnpm run start
# Open http://localhost:3001
```

### Extract the Pre-built Archive

```bash
tar xzf panelshelf-v0.1.0.tar.gz
cd panelshelf-v0.1.0
# Install production dependencies only
pnpm install --prod
pnpm run db:migrate
pnpm run start
```

## Full Documentation

See the [README](https://github.com/me-cedric/panelshelf#readme) for complete documentation including:

- [Architecture overview](https://github.com/me-cedric/panelshelf#-architecture)
- [Feature list](https://github.com/me-cedric/panelshelf#-features)
- [Configuration options](https://github.com/me-cedric/panelshelf#configuration)
- [API reference](https://github.com/me-cedric/panelshelf#-api)
- [Desktop app build guide](https://github.com/me-cedric/panelshelf#%EF%B8%8F-desktop-app)
- [Contributing guidelines](https://github.com/me-cedric/panelshelf#-contributing)

## Changelog

See [CHANGELOG.md](https://github.com/me-cedric/panelshelf/blob/main/CHANGELOG.md) for the full changelog.

## Supported Sources

| Source | Type |
|--------|------|
| GetComics | RSS-based |
| Digital Comic Museum | Provider-based |
| ZipComic | Provider-based (Cloudflare-aware) |
| Internet Archive | Provider-based (official API) |
| Any RSS/Atom feed | Auto-detected |
| Any WordPress site | Auto-detected |

## Known Limitations

- Unit tests are not yet implemented (planned for v0.2.0)
- Authentication is not yet implemented
- PDF comic format support is planned
- The `@yao-pkg/pkg` bundler may not fully support `better-sqlite3` native module
