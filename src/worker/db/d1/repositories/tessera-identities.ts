import { eq } from "drizzle-orm";

import { type D1DbExecutor, tesseraIdentities } from "@/worker/db/d1";

export type TesseraIdentityRow = typeof tesseraIdentities.$inferSelect;
export type NewTesseraIdentityRow = typeof tesseraIdentities.$inferInsert;

export const findIdentityBySub = async (db: D1DbExecutor, sub: string): Promise<TesseraIdentityRow | undefined> => {
  const rows = await db.select().from(tesseraIdentities).where(eq(tesseraIdentities.sub, sub)).limit(1);
  return rows[0];
};

export const findIdentityByUserId = async (
  db: D1DbExecutor,
  userId: string,
): Promise<TesseraIdentityRow | undefined> => {
  const rows = await db.select().from(tesseraIdentities).where(eq(tesseraIdentities.userId, userId)).limit(1);
  return rows[0];
};

export const findUserIdBySub = async (db: D1DbExecutor, sub: string): Promise<string | null> => {
  const rows = await db
    .select({ userId: tesseraIdentities.userId })
    .from(tesseraIdentities)
    .where(eq(tesseraIdentities.sub, sub))
    .limit(1);
  return rows[0]?.userId ?? null;
};

export const bumpLastSeenAt = async (db: D1DbExecutor, sub: string, lastSeenAt: number): Promise<void> => {
  await db.update(tesseraIdentities).set({ lastSeenAt }).where(eq(tesseraIdentities.sub, sub));
};

export const insertIdentity = async (
  db: D1DbExecutor,
  row: NewTesseraIdentityRow,
): Promise<TesseraIdentityRow | undefined> => {
  const rows = await db.insert(tesseraIdentities).values(row).returning();
  return rows[0];
};
