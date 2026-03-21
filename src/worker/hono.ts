import type { Context } from "hono";

import type { SessionRecord } from "@/worker/auth/sessions";
import type { D1Db } from "@/worker/db/d1";
import type { UserRow } from "@/worker/db/d1/repositories";

export interface AppVariables {
  db: D1Db;
  session: SessionRecord;
  sessionId: string;
  user: UserRow;
}

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

export type AppContext = Context<AppEnv>;
