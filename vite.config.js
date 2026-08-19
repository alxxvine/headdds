import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Which build is this, stamped at build time so the page can say so. Three
// merged fixes once sat invisible behind a deploy that was silently failing,
// and nothing on the page could tell a stale build from a fresh one.
function buildStamp() {
  let sha = 'unknown';
  try { sha = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* no git */ }
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${sha} · ${when}`;
}

// base is needed for GitHub Pages: the site lives at /<repo>/
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(buildStamp()),
  },
});
