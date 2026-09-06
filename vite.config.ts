import { defineConfig } from 'vite';

// GitHub Pages serves the site at /grammar-garden/, so assets must use that base.
export default defineConfig({
  base: process.env.GH_PAGES ? '/grammar-garden/' : '/',
  build: { target: 'es2022' },
  test: { environment: 'node' },
} as any);
