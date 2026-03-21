import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "@/worker/db/d1/schema";

export type D1Executor = D1Database | D1DatabaseSession;
export type D1Db<TClient extends D1Executor = D1Executor> = DrizzleD1Database<typeof schema> & { $client: TClient };

export function createD1Db(executor: D1Database): D1Db<D1Database>;
export function createD1Db(executor: D1DatabaseSession): D1Db<D1DatabaseSession>;
export function createD1Db(executor: D1Executor): D1Db {
  if ("withSession" in executor) {
    return drizzle(executor, { schema });
  }

  return drizzle(executor, { schema });
}
export type D1DbExecutor = D1Db;
