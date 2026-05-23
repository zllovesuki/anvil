import { test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("tessera sign-in", () => {
  test("creates the operator account from the first verified OIDC identity", async ({
    livePage,
    e2eContext,
    operatorIdentity,
  }) => {
    await loginViaUi(livePage, e2eContext, operatorIdentity);

    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    const sessionCookie = (await livePage.context().cookies()).find((cookie) => cookie.name === "__Host-anvil_session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
  });
});
