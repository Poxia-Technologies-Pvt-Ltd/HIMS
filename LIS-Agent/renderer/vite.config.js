import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname), // 🔥 important
  base: './', // 🔥 EXTREMELY important for Electron file:// protocol
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../dist'), // Output to project root /dist
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "lucide-react": path.resolve(__dirname, "../node_modules/lucide-react"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7005',
        changeOrigin: true,
        secure: false,
        headers: {
          Origin: 'http://localhost:7005'
        }
      }
    },
    fs: {
      allow: [
        path.resolve(__dirname, ".."),
      ],
    },
  },
});