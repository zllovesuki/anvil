import { test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("Return login", () => {
  test("logs in with existing operator credentials", async ({ livePage, operatorCredentials }) => {
    await livePage.goto("/app/login");

    // Overwrite whatever the current auth mode seeded into the form.
    await livePage.getByLabel("Email").fill(operatorCredentials.email);
    await livePage.getByLabel("Password", { exact: true }).fill(operatorCredentials.password);

    await livePage.getByRole("button", { name: "Sign In" }).click();

    await livePage.waitForURL("**/app/projects");
    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("session persists across page reload", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);

    await livePage.reload({ waitUntil: "networkidle" });

    await expect(livePage).toHaveURL(/\/app\/projects/);
    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });
});
