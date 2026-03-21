import { test, expect, loginViaUi } from "../fixtures/anvil-test";

test.describe("Project CRUD", () => {
  test("can create a project", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);
    await livePage.goto("/app/projects/new");

    await livePage.getByLabel("Project name").fill("CI Test Project");

    // Slug auto-generates from the name — just verify it has a value.
    await expect(livePage.getByLabel("Project slug")).not.toHaveValue("");

    await livePage.getByLabel("Repository URL").fill("https://github.com/miragespace/ci-test");

    // "Default branch" and "Config path" are pre-filled; leave them.

    await livePage.getByRole("button", { name: "Create Project" }).click();

    await livePage.waitForURL("**/app/projects");
    await expect(livePage.getByText("CI Test Project")).toBeVisible();
  });

  test("can view project detail", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);
    await livePage.goto("/app/projects");

    // Click the project card link — use role to avoid matching nested text nodes.
    await livePage.getByRole("link").filter({ hasText: "CI Test Project" }).first().click();

    await expect(livePage.getByRole("navigation", { name: "Breadcrumb" })).toContainText("CI Test Project");
    await expect(livePage.getByText("github.com")).toBeVisible();
    await expect(livePage.getByText("Run history")).toBeVisible();
    await expect(livePage.getByRole("button", { name: "Trigger Run" })).toBeVisible();
  });

  test("can edit project settings", async ({ livePage, operatorCredentials }) => {
    await loginViaUi(livePage, operatorCredentials);
    await livePage.goto("/app/projects");

    await livePage.getByRole("link").filter({ hasText: "CI Test Project" }).first().click();

    await livePage.getByRole("link", { name: /Settings/ }).click();

    await expect(livePage.getByRole("heading", { name: "Update project" })).toBeVisible();

    const nameInput = livePage.getByLabel("Project name");
    await nameInput.clear();
    await nameInput.fill("CI Test Project Updated");

    await livePage.getByRole("button", { name: "Save Changes" }).click();

    // Redirect back to project detail page.
    await expect(livePage.getByRole("navigation", { name: "Breadcrumb" })).toContainText("CI Test Project Updated");
  });
});
