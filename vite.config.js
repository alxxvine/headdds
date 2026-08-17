import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base нужен для GitHub Pages: сайт живёт на /<repo>/
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
});
