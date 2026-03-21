import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const persistStatePath = process.env.ANVIL_PERSIST_STATE_PATH;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(
      persistStatePath
        ? {
            persistState: {
              path: persistStatePath,
            },
          }
        : undefined,
    ),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
