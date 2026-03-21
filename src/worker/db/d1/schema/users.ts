import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at").notNull(),
    disabledAt: integer("disabled_at"),
  },
  (table) => [uniqueIndex("idx_users_slug").on(table.slug), uniqueIndex("idx_users_email").on(table.email)],
);
