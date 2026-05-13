# @loontail/minecraft-launcher

Loontail Minecraft launcher built on Electron + React + Tailwind v4.

## Documentation

- [Architecture](./docs/architecture.md) — process model, modules, IPC, services.
- [Code guideline](./docs/code-guideline.md) — TypeScript, naming, testing,
  security, git conventions.
- [UI guideline](./docs/ui-guideline.md) — shadcn, Tailwind v4 palette,
  typography, dark-only theming.

## Requirements

- Node.js 20+
- npm

## Getting started

```bash
npm install
npm run dev
```

## Scripts

| Command           | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start electron-vite in development mode.      |
| `npm run build`   | Type-check and produce production bundles.    |
| `npm run build:win` / `:mac` / `:linux` | Build a platform installer. |
| `npm run typecheck` | Type-check the whole project.               |
| `npm run lint`    | Run Biome lint + format check.                |
| `npm run lint:fix` | Apply Biome auto-fixes.                      |
| `npm run format`  | Format the codebase with Biome.               |
| `npm test`        | Run Vitest once.                              |
| `npm run test:watch` | Run Vitest in watch mode.                  |

## Project layout

See [`docs/architecture.md`](./docs/architecture.md) §12.
