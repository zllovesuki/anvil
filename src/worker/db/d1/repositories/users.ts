import { and, eq, sql } from "drizzle-orm";

import { type D1DbExecutor, invites, users } from "@/worker/db/d1";

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

export const buildInsertUserForAcceptedInviteStatement = (
  db: D1DbExecutor,
  row: NewUserRow,
  tokenHash: Uint8Array,
  acceptedByUserId: string,
  acceptedAt: number,
) => {
  const disabledAt = row.disabledAt ?? null;

  return db.insert(users).select(
    db
      .select({
        id: sql<string>`${row.id}`.as("id"),
        slug: sql<string>`${row.slug}`.as("slug"),
        email: sql<string>`${row.email}`.as("email"),
        displayName: sql<string>`${row.displayName}`.as("displayName"),
        createdAt: sql<number>`${row.createdAt}`.as("createdAt"),
        disabledAt: (disabledAt === null ? sql<null>`null` : sql<number>`${disabledAt}`).as("disabledAt"),
      })
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          eq(invites.acceptedByUserId, acceptedByUserId),
          eq(invites.acceptedAt, acceptedAt),
        ),
      ),
  );
};

export const insertUser = async (db: D1DbExecutor, row: NewUserRow): Promise<void> => {
  await db.insert(users).values(row);
};

export const deleteUserById = async (db: D1DbExecutor, userId: string): Promise<void> => {
  await db.delete(users).where(eq(users.id, userId));
};
