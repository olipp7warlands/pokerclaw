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
      // Point to engine TypeScript source so vitest doesn't need a pre-built dist
      "@pokercrawl/engine": join(__dirname, "../engine/src/index.ts"),
    },
  },
});
