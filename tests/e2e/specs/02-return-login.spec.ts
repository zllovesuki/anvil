import { test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("Return login", () => {
  test("logs in with the existing tessera identity", async ({ livePage, e2eContext, operatorIdentity }) => {
    await loginViaUi(livePage, e2eContext, operatorIdentity);

    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("session persists across page reload", async ({ livePage, e2eContext, operatorIdentity }) => {
    await loginViaUi(livePage, e2eContext, operatorIdentity);

    await livePage.reload({ waitUntil: "networkidle" });

    await expect(livePage).toHaveURL(/\/app\/projects/);
    await expect(livePage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });
});
