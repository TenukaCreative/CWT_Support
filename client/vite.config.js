import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev, so the httpOnly refresh cookie works without extra CORS/SameSite pain.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', 'src/main.jsx'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 92, statements: 92, functions: 80, branches: 80 },
    },
  },
});
