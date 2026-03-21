import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projectIndex = sqliteTable(
  "project_index",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerSlug: text("owner_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    name: text("name").notNull(),
    repoUrl: text("repo_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    configPath: text("config_path").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_index_owner_project_slug").on(table.ownerSlug, table.projectSlug),
    index("idx_project_index_owner_user_updated_at").on(table.ownerUserId, desc(table.updatedAt)),
    index("idx_project_index_updated_at").on(desc(table.updatedAt)),
  ],
);
