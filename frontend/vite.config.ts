import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'esnext',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks: {
          // Chart.js es ~200KB → solo carga con EstadisticasModal
          'chart': ['chart.js', 'react-chartjs-2'],
          // Socket.IO se difiere → chunk separado
          'socketio': ['socket.io-client'],
          // React core
          'vendor-react': ['react', 'react-dom'],
          // React Query
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
})
