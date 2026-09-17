import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Served from https://smasifhossain.github.io/coldchain-chocolate/
export default defineConfig({
  base: '/coldchain-chocolate/',
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
  },
})
