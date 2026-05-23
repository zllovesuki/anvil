import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import * as d1Schema from "@/worker/db/d1/schema";

describe("tessera_identities schema", () => {
  registerWorkerRuntimeHooks();

  it("rejects duplicate sub values", async () => {
    const first = await seedUser({ email: "identity-sub-a@example.com", slug: "identity-sub-a" });
    const second = await seedUser({ email: "identity-sub-b@example.com", slug: "identity-sub-b" });

    await getDb().insert(d1Schema.tesseraIdentities).values({
      sub: "shared-sub",
      userId: first.id,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    await expect(
      getDb().insert(d1Schema.tesseraIdentities).values({
        sub: "shared-sub",
        userId: second.id,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("rejects duplicate user_id values", async () => {
    const user = await seedUser({ email: "identity-user@example.com", slug: "identity-user" });

    await getDb().insert(d1Schema.tesseraIdentities).values({
      sub: "sub-1",
      userId: user.id,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    await expect(
      getDb().insert(d1Schema.tesseraIdentities).values({
        sub: "sub-2",
        userId: user.id,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("cascades identity rows when a user is deleted", async () => {
    const user = await seedUser({ email: "identity-cascade@example.com", slug: "identity-cascade" });

    await getDb().insert(d1Schema.tesseraIdentities).values({
      sub: "cascade-sub",
      userId: user.id,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    await getDb().delete(d1Schema.users).where(eq(d1Schema.users.id, user.id));

    const rows = await getDb()
      .select()
      .from(d1Schema.tesseraIdentities)
      .where(eq(d1Schema.tesseraIdentities.sub, "cascade-sub"));
    expect(rows).toHaveLength(0);
  });
});
