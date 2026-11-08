import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` (wrangler dev, port 8787) serves the API + Durable Objects.
// `npm run dev:ui` runs Vite with hot reload and forwards /api there, WebSockets included.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
