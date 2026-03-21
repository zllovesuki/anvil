import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/worker/db/durable/schema/project-do.ts",
  out: "./drizzle/project-do",
  strict: true,
  verbose: true,
});
