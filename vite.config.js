import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is needed for GitHub Pages: the site lives at /<repo>/
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
});
