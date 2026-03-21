import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { DrizzleConfig } from "drizzle-orm/utils";

declare module "drizzle-orm/d1" {
  // D1 sessions expose the prepared-statement surface drizzle uses, but the
  // upstream types only accept full D1Database instances.
  export function drizzle<TSchema extends Record<string, unknown> = Record<string, never>>(
    client: D1DatabaseSession,
    config?: DrizzleConfig<TSchema>,
  ): DrizzleD1Database<TSchema> & { $client: D1DatabaseSession };
}
