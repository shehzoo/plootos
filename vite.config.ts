import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  plugins: [preact()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Hashed file names: each version gets new names (spec 4.8).
    assetsDir: 'assets',
  },
})
