import { and, eq, sql } from "drizzle-orm";

import { type D1DbExecutor, invites, passwordCredentials } from "@/worker/db/d1";

export type PasswordCredentialRow = typeof passwordCredentials.$inferSelect;
export type NewPasswordCredentialRow = typeof passwordCredentials.$inferInsert;

export const findPasswordCredentialByUserId = async (
  db: D1DbExecutor,
  userId: string,
): Promise<PasswordCredentialRow | undefined> => {
  const rows = await db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, userId)).limit(1);

  return rows[0];
};

export const buildInsertPasswordCredentialForAcceptedInviteStatement = (
  db: D1DbExecutor,
  row: NewPasswordCredentialRow,
  tokenHash: Uint8Array,
  acceptedByUserId: string,
  acceptedAt: number,
) =>
  db.insert(passwordCredentials).select(
    db
      .select({
        userId: sql<string>`${row.userId}`.as("userId"),
        algorithm: sql<string>`${row.algorithm}`.as("algorithm"),
        digest: sql<string>`${row.digest}`.as("digest"),
        iterations: sql<number>`${row.iterations}`.as("iterations"),
        salt: sql<Uint8Array>`${row.salt}`.as("salt"),
        passwordHash: sql<Uint8Array>`${row.passwordHash}`.as("passwordHash"),
        updatedAt: sql<number>`${row.updatedAt}`.as("updatedAt"),
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

export const insertPasswordCredential = async (db: D1DbExecutor, row: NewPasswordCredentialRow): Promise<void> => {
  await db.insert(passwordCredentials).values(row);
};

export const deletePasswordCredentialByUserId = async (db: D1DbExecutor, userId: string): Promise<void> => {
  await db.delete(passwordCredentials).where(eq(passwordCredentials.userId, userId));
};
