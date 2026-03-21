import { describe, expect, it } from "vitest";

import d1MigrationJournal from "../../drizzle/d1/meta/_journal.json";

import { readAppD1Migrations } from "../helpers/runtime";

describe("test runtime helpers", () => {
  it("loads D1 migrations from the drizzle journal", () => {
    const migrations = readAppD1Migrations();

    expect(migrations).toHaveLength(d1MigrationJournal.entries.length);
    expect(migrations.map((migration) => migration.name)).toEqual(
      d1MigrationJournal.entries.map((entry) => `${entry.tag}.sql`),
    );
    expect(migrations.every((migration) => migration.queries.length > 0)).toBe(true);
  });
});
