import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 420_000,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 420_000,
  },
});
