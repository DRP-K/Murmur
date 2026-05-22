import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      // Forward /api to the relay server in browser dev mode to avoid CORS
      "/api": {
        target: process.env.VITE_RELAY_URL ?? "https://murmur.bajzc.com",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
