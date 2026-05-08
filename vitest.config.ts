import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const VITEST_POOL_COMPATIBILITY_FLAGS = [
  "enable_nodejs_tty_module",
  "enable_nodejs_fs_module",
  "enable_nodejs_http_modules",
  "enable_nodejs_perf_hooks_module",
  "enable_nodejs_v8_module",
  "enable_nodejs_process_v2",
];

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker/index.ts",
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        assets: {
          directory: "./tests/assets",
        },
        compatibilityFlags: VITEST_POOL_COMPATIBILITY_FLAGS,
        bindings: {
          APP_ENCRYPTION_KEY_CURRENT_VERSION: "1",
          APP_ENCRYPTION_KEYS_JSON: JSON.stringify({
            1: TEST_ENCRYPTION_KEY,
          }),
          TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
          TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**/*.test.ts"],
  },
});
