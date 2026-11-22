import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  // The local Worker's CORS and the extension's externally_connectable origin
  // check both expect http://localhost:5173, so fail rather than drift to 5174.
  server: { port: 5173, strictPort: true },
})
