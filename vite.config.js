import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    }
  },
  build: {
    // Pull heavy third-party libraries into their own chunks so they can be
    // cached independently of our application code (and so a code-change in
    // `src/` doesn't invalidate the ~2 MB of vendor JS the browser already
    // has on disk).
    //
    // The previous build shipped a single 3.0 MB `index-*.js` chunk; this
    // splits it into ~6 smaller files that load in parallel and roughly
    // halves first-paint cost on a cold visit. The Scene chunk was already
    // lazy via `React.lazy()` in LoginCinematic, so it stays standalone.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-is', 'react-router-dom'],
          'vendor-three':   ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          'vendor-charts':  ['recharts'],
          'vendor-icons':   ['lucide-react'],
          'vendor-pdf':     ['pdfjs-dist', 'jspdf', 'jspdf-autotable', 'html2canvas'],
          'vendor-motion':  ['framer-motion'],
          'vendor-markdown':['react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize']
        }
      }
    }
  }
})
