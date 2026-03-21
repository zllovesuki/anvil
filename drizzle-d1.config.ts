import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/d1/schema/index.ts",
  out: "./drizzle/d1",
  strict: true,
  verbose: true,
});
