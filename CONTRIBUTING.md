# Contributing to PanelShelf

First off, thanks for taking the time to contribute! 🎉

## Code of Conduct

This project and everyone participating in it is governed by the [PanelShelf Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/me-cedric/panelshelf/issues) to see if the problem has already been reported. If it hasn't, [open a new issue](https://github.com/me-cedric/panelshelf/issues/new) and include:

- **A clear, descriptive title**
- **Steps to reproduce** the behavior
- **Expected behavior** vs **actual behavior**
- **Screenshots** if applicable
- **Environment details** (OS, Node.js version, browser, etc.)

### Suggesting Enhancements

Feature requests are welcome! Open an issue with:

- **A clear, descriptive title** prefixed with `[Feature]`
- **A detailed description** of the proposed feature
- **Use case** — why this would be valuable
- **Alternatives considered**

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies** — `pnpm install`
3. **Run migrations** — `pnpm run db:migrate`
4. **Make your changes** — follow the existing code style and patterns
5. **Type-check** — `pnpm run typecheck` (must pass with zero errors)
6. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `chore:` — maintenance, tooling, dependencies
   - `docs:` — documentation only
   - `refactor:` — code change that neither fixes a bug nor adds a feature
   - `test:` — adding or updating tests
7. **Push** to your fork and submit a Pull Request

### PR Review Process

- Maintainers will review your PR and may request changes
- All CI checks must pass (type-check, build)
- PRs should focus on a single concern — avoid mixed changes
- Keep PRs reasonably scoped (prefer multiple small PRs over one large one)

## Development Setup

See the [Development section](README.md#-development) in the README for detailed setup instructions.

### Project Structure

```
panelshelf/
├── packages/
│   ├── frontend/     # React + Vite web application
│   ├── backend/      # Fastify + TypeScript API server
│   └── desktop/      # Tauri v2 desktop wrapper (Rust)
├── .github/          # GitHub Actions workflows
└── docker-compose.yml
```

### Adding a New Provider

Provider adapters follow the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  id: string;
  name: string;
  canHandle(url: string): boolean;
  inspect(url: string, options?: ProviderInspectOptions): Promise<ProviderInspectionResult>;
  download(request: DownloadRequest): Promise<DownloadResult>;
}
```

1. Create `packages/backend/src/providers/<name>/index.ts`
2. Implement `ProviderAdapter`
3. Register in `packages/backend/src/index.ts` via `registerProvider()`
4. Add auto-detection in `packages/backend/src/routes/sources.ts` (optional)

### Coding Standards

- **TypeScript** — Strict mode enabled, no `any` types (except where required by Drizzle ORM)
- **Imports** — Use ES module imports (the project uses `"type": "module"`)
- **Formatting** — Use consistent indentation and naming conventions matching existing code
- **React** — Functional components with hooks, no class components
- **API Routes** — Every route should include an OpenAPI schema (`tags`, `summary`, `description`, `response`)
- **Database** — Schema changes go through Drizzle migrations

## Questions?

Feel free to open a [Discussion](https://github.com/me-cedric/panelshelf/discussions) for questions, ideas, or general chat.
