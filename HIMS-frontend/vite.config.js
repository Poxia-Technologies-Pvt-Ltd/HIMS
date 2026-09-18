import react from '@vitejs/plugin-react'

/** @type {import('vite').UserConfig} */
export default {
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7005',
        changeOrigin: true,
        secure: false,
      }
    }
  }
}
