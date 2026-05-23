import { LOGIN_URL_PATTERN, test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("Profile and sign out", () => {
  test("can view profile page", async ({ livePage, e2eContext, operatorIdentity }) => {
    await loginViaUi(livePage, e2eContext, operatorIdentity);

    await livePage.goto("/app/me");

    await expect(livePage.getByRole("heading", { name: "Profile & Settings" })).toBeVisible();

    // Use heading role to distinguish from the user menu button which also shows the name.
    await expect(livePage.getByRole("heading", { name: operatorIdentity.displayName })).toBeVisible();
    await expect(livePage.getByText(operatorIdentity.email)).toBeVisible();
    await expect(livePage.getByText(`@${operatorIdentity.slug}`)).toBeVisible();
  });

  test("can sign out and is redirected to login", async ({ livePage, e2eContext, operatorIdentity }) => {
    await loginViaUi(livePage, e2eContext, operatorIdentity);

    await livePage.goto("/app/me");
    await livePage.getByRole("button", { name: "Sign Out" }).click();
    const confirmDialog = livePage.getByRole("dialog", { name: "Sign out?" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Sign Out" }).click();

    await livePage.waitForURL(LOGIN_URL_PATTERN);

    // Session should be cleared — navigating to a protected route redirects back.
    await livePage.goto("/app/projects");
    await livePage.waitForURL(LOGIN_URL_PATTERN);
  });
});
