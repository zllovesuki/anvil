import { createD1Db, type D1Db } from "@/worker/db/d1/client";

export const D1_BOOKMARK_HEADER = "x-anvil-d1-bookmark";

export interface D1SessionContext {
  session: D1DatabaseSession;
  db: D1Db;
  getBookmark: () => string | null;
}

export const openSession = (env: Env, bookmark: string): D1SessionContext => {
  const session = env.DB.withSession(bookmark);

  return {
    session,
    db: createD1Db(session),
    getBookmark: () => session.getBookmark() ?? null,
  };
};

export const openReadSession = (request: Request, env: Env): D1SessionContext => {
  const bookmark = request.headers.get(D1_BOOKMARK_HEADER) ?? "first-unconstrained";
  return openSession(env, bookmark);
};

export const openPrimarySession = (request: Request, env: Env): D1SessionContext => openSession(env, "first-primary");
