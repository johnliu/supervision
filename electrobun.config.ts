import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Supervision',
    identifier: 'supervision.johnliu.me',
    version: '0.1.0',
    description: 'Native code-review companion for LLM-driven development',
  },
  // Where stable releases live. Electrobun bakes this into the app and the
  // updater resolves update.json / patches against it. GitHub's
  // `releases/latest/download` always points at the newest published release.
  release: {
    baseUrl: 'https://github.com/johnliu/supervision/releases/latest/download',
  },
  build: {
    // Vite builds to dist/, we copy from there
    copy: {
      'dist/index.html': 'views/mainview/index.html',
      'dist/assets': 'views/mainview/assets',
    },
    // Ignore Vite output in watch mode — HMR handles view rebuilds separately
    watchIgnore: [
      'dist/**',
    ],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
