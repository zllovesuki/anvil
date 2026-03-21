import { test, expect } from "../fixtures/anvil-test";

test.describe("Bootstrap invite acceptance", () => {
  test("accepts the bootstrap invite and creates the operator account", async ({
    livePage,
    e2eContext,
    operatorCredentials,
  }) => {
    await livePage.goto(`/app/invite/accept?token=${e2eContext.inviteToken}`);

    // Wait for the invite form to be fully rendered before interacting.
    const submitButton = livePage.getByRole("button", { name: "Create Account" });
    await expect(submitButton).toBeVisible();

    // The invite token field should be pre-filled from the URL query param.
    await expect(livePage.getByLabel("Invite token")).toHaveValue(e2eContext.inviteToken);

    await livePage.getByLabel("Email").fill(operatorCredentials.email);
    await livePage.getByLabel("Display name").fill(operatorCredentials.displayName);

    // Use the input id directly — the slug field auto-generates from display name
    // and getByLabel can race with React re-renders that update the slug value.
    await livePage.locator("#input-operator-slug").fill(operatorCredentials.slug);

    await livePage.getByLabel("Password", { exact: true }).fill(operatorCredentials.password);
    await livePage.getByLabel("Confirm password").fill(operatorCredentials.password);

    await submitButton.click();

    await livePage.waitForURL("**/app/projects");
    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });
});
