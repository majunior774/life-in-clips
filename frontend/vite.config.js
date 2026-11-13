import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Development only: where the dev server forwards /api (the local backend).
  // Not exposed to the client bundle. Override in frontend/.env if your backend port differs.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_TARGET || 'http://localhost:3001';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { '/api': apiTarget },
    },
  };
});
