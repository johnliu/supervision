# React + Tailwind + Vite Electrobun Template

A fast Electrobun desktop app template with React, Tailwind CSS, and Vite for hot module replacement (HMR).

## Testing & web mode

The diff pane's behavior is specified in [docs/specs/](docs/specs/) — every
spec item maps to a test, and every bug fix starts with a failing spec-tagged
test (see [docs/specs/README.md](docs/specs/README.md) for the workflow).

```bash
# One-time: Playwright browsers
devbox run -- bun run playwright:install

devbox run -- bun run test:unit         # pure nav-model tests (bun test, ~100ms)
devbox run -- bun run test:e2e          # Playwright vs the real app in web mode (webkit + chromium)
devbox run -- bun run test:e2e:webkit   # webkit only — the engine family WKWebView ships
devbox run -- bun run test              # full gate: typecheck + unit + spec coverage + e2e

# Manual web mode: the real app in a browser on deterministic fixtures
devbox run -- bun run dev:web           # opens /web.html; ?fixture=gaps-large&style=unified etc.
```

Web mode (`src/mainview/web/`) renders the full app through the platform seam
(`src/mainview/platform.ts`) against an in-memory backend — no Electrobun.
Nothing web-mode ships in the packaged app.

## Getting Started

```bash
# Install dependencies
bun install

# Development without HMR (uses bundled assets)
bun run dev

# Development with HMR (recommended)
bun run dev:hmr

# Build for production
bun run build

# Build for production release
bun run build:prod
```

## How HMR Works

When you run `bun run dev:hmr`:

1. **Vite dev server** starts on `http://localhost:5173` with HMR enabled
2. **Electrobun** starts and detects the running Vite server
3. The app loads from the Vite dev server instead of bundled assets
4. Changes to React components update instantly without full page reload

When you run `bun run dev` (without HMR):

1. Electrobun starts and loads from `views://mainview/index.html`
2. You need to rebuild (`bun run build`) to see changes

## Project Structure

```
├── src/
│   ├── bun/
│   │   └── index.ts        # Main process (Electrobun/Bun)
│   └── mainview/
│       ├── App.tsx         # React app component
│       ├── main.tsx        # React entry point
│       ├── index.html      # HTML template
│       └── index.css       # Tailwind CSS
├── electrobun.config.ts    # Electrobun configuration
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind configuration
└── package.json
```

## Customizing

- **React components**: Edit files in `src/mainview/`
- **Tailwind theme**: Edit `tailwind.config.js`
- **Vite settings**: Edit `vite.config.ts`
- **Window settings**: Edit `src/bun/index.ts`
- **App metadata**: Edit `electrobun.config.ts`
