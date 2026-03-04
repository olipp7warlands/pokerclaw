import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@pokercrawl/engine": join(__dirname, "../engine/src/index.ts"),
      "@pokercrawl/mcp-server": join(__dirname, "../mcp-server/src/index.ts"),
    },
  },
});
