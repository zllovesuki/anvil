import { test, expect } from "../fixtures/anvil-test";

test.describe("Auth guards", () => {
  test("redirects unauthenticated user from protected routes to login", async ({ livePage }) => {
    await livePage.goto("/app/projects");
    await livePage.waitForURL("**/app/login");

    await livePage.goto("/app/projects/new");
    await livePage.waitForURL("**/app/login");

    await livePage.goto("/app/me");
    await livePage.waitForURL("**/app/login");
  });

  test("landing page is accessible without authentication", async ({ livePage }) => {
    await livePage.goto("/");

    // Use a specific heading from the landing page hero section.
    await expect(livePage.getByRole("link", { name: "anvil Edge-native CI" })).toBeVisible();
    await expect(livePage).toHaveURL(/\/$/);
  });
});
