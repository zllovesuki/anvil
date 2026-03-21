import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { bytes } from "@/worker/db";

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    createdByUserId: text("created_by_user_id").notNull(),
    tokenHash: bytes("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedByUserId: text("accepted_by_user_id"),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_invites_token_hash").on(table.tokenHash),
    index("idx_invites_created_by_created_at").on(table.createdByUserId, desc(table.createdAt)),
    index("idx_invites_expires_at").on(table.expiresAt),
  ],
);
