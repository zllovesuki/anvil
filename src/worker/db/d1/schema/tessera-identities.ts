import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "@/worker/db/d1/schema/users";

export const tesseraIdentities = sqliteTable(
  "tessera_identities",
  {
    sub: text("sub").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
  },
  (table) => [uniqueIndex("idx_tessera_identities_user_id").on(table.userId)],
);
