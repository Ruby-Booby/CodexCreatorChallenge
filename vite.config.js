import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // The packaged Electron app should never white-screen because of an optimizer edge-case.
    // Keep production bundles readable/stable for the challenge; size isn't the bottleneck here.
    minify: false,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  }
})
