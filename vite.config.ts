import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// In a git worktree the deps resolve through the main checkout's node_modules;
// that root must be on the dev server's fs allow list or @fontsource assets 403.
const require = createRequire(import.meta.url);
const fontsourcePkg = require.resolve('@fontsource-variable/inter/package.json');
const externalNodeModules = fontsourcePkg.slice(
  0,
  fontsourcePkg.lastIndexOf('/node_modules/') + '/node_modules'.length,
);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/mainview', import.meta.url)),
    },
  },
  root: 'src/mainview',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      // The packaged app builds ONLY the Electrobun entry. web.html is a
      // dev-server-only page (web mode / Playwright) and must never reach
      // dist/, which Electrobun copies into the .app bundle wholesale.
      input: fileURLToPath(new URL('./src/mainview/index.html', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // Setting fs.allow replaces the default, so the workspace root must be
      // listed explicitly alongside the external node_modules root.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        externalNodeModules,
      ],
    },
  },
});
