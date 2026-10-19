import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' so the build works from any sub-path (e.g. GitHub Pages /poker/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
