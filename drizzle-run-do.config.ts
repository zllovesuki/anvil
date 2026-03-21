import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/worker/db/durable/schema/run-do.ts",
  out: "./drizzle/run-do",
  strict: true,
  verbose: true,
});
