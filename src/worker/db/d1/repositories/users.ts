import { eq } from "drizzle-orm";

import { type D1DbExecutor, users } from "@/worker/db/d1";

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const findUserById = async (db: D1DbExecutor, userId: string): Promise<UserRow | undefined> => {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
};

export const findUserByEmail = async (db: D1DbExecutor, email: string): Promise<UserRow | undefined> => {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
};

export const findUserBySlug = async (db: D1DbExecutor, slug: string): Promise<UserRow | undefined> => {
  const rows = await db.select().from(users).where(eq(users.slug, slug)).limit(1);
  return rows[0];
};

export const insertUser = async (db: D1DbExecutor, row: NewUserRow): Promise<void> => {
  await db.insert(users).values(row);
};

export const deleteUserById = async (db: D1DbExecutor, userId: string): Promise<void> => {
  await db.delete(users).where(eq(users.id, userId));
};
