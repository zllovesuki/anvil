import { and, eq, gt, isNull } from "drizzle-orm";

import { type D1DbExecutor, invites } from "@/worker/db/d1";

export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;

export const findInviteById = async (db: D1DbExecutor, inviteId: string): Promise<InviteRow | undefined> => {
  const rows = await db.select().from(invites).where(eq(invites.id, inviteId)).limit(1);
  return rows[0];
};

export const findInviteByTokenHash = async (
  db: D1DbExecutor,
  tokenHash: Uint8Array,
): Promise<InviteRow | undefined> => {
  const rows = await buildFindInviteByTokenHashStatement(db, tokenHash);

  return rows[0];
};

export const buildFindInviteByTokenHashStatement = (db: D1DbExecutor, tokenHash: Uint8Array) =>
  db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1);

export const insertInvite = async (db: D1DbExecutor, row: NewInviteRow): Promise<void> => {
  await db.insert(invites).values(row);
};

export const buildClaimInviteStatement = (
  db: D1DbExecutor,
  inviteId: string,
  acceptedByUserId: string,
  acceptedAt: number,
) =>
  db
    .update(invites)
    .set({ acceptedByUserId, acceptedAt })
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt), gt(invites.expiresAt, acceptedAt)))
    .returning({ id: invites.id });

export const buildClaimInviteByTokenHashStatement = (
  db: D1DbExecutor,
  tokenHash: Uint8Array,
  acceptedByUserId: string,
  acceptedAt: number,
) =>
  db
    .update(invites)
    .set({ acceptedByUserId, acceptedAt })
    .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt), gt(invites.expiresAt, acceptedAt)))
    .returning({ id: invites.id });

export const claimInvite = async (
  db: D1DbExecutor,
  inviteId: string,
  acceptedByUserId: string,
  acceptedAt: number,
): Promise<boolean> => {
  const rows = await buildClaimInviteStatement(db, inviteId, acceptedByUserId, acceptedAt);

  return rows.length === 1;
};
