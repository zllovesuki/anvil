import { test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("Profile and sign out", () => {
  test("can view profile page", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);

    await livePage.goto("/app/me");

    await expect(livePage.getByRole("heading", { name: "Profile & Settings" })).toBeVisible();

    // Use heading role to distinguish from the user menu button which also shows the name.
    await expect(livePage.getByRole("heading", { name: operatorCredentials.displayName })).toBeVisible();
    await expect(livePage.getByText(operatorCredentials.email)).toBeVisible();
    await expect(livePage.getByText(`@${operatorCredentials.slug}`)).toBeVisible();
  });

  test("can sign out and is redirected to login", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);

    await livePage.goto("/app/me");
    await livePage.getByRole("button", { name: "Sign Out" }).click();

    await livePage.waitForURL("**/app/login");

    // Session should be cleared — navigating to a protected route redirects back.
    await livePage.goto("/app/projects");
    await livePage.waitForURL("**/app/login");
  });
});
