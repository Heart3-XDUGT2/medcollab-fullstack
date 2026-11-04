import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../.runtime/statistics/vite-cache', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 61037, strictPort: true },
});
