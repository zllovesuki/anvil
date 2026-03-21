import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { bytes } from "@/worker/db";

export const passwordCredentials = sqliteTable("password_credentials", {
  userId: text("user_id").primaryKey(),
  algorithm: text("algorithm").notNull(),
  digest: text("digest").notNull(),
  iterations: integer("iterations").notNull(),
  salt: bytes("salt").notNull(),
  passwordHash: bytes("password_hash").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
