import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api":     { target: "http://localhost:3000", changeOrigin: true },
      "/health":  { target: "http://localhost:3000", changeOrigin: true },
      "/gateway": { target: "http://localhost:3000", changeOrigin: true },
      "/ws-ui":   { target: "ws://localhost:3000",   ws: true },
      "/ws":      { target: "ws://localhost:3000",   ws: true },
    },
  },
  resolve: {
    alias: {
      "@pokercrawl/engine": fileURLToPath(
        new URL("../engine/src/index.ts", import.meta.url)
      ),
      // Shim Node.js crypto for the engine's randomUUID usage in browser
      crypto: fileURLToPath(
        new URL("./src/lib/crypto-browser.ts", import.meta.url)
      ),
    },
  },
});
