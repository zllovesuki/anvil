import { test as base, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { E2eContext } from "../global-setup";

export interface OperatorCredentials {
  email: string;
  displayName: string;
  slug: string;
  password: string;
}

const OPERATOR_CREDENTIALS: OperatorCredentials = {
  email: "e2e-operator@example.com",
  displayName: "E2E Operator",
  slug: "e2e-operator",
  password: "e2e-P@ssw0rd-stable",
};

interface AnvilFixtures {
  e2eContext: E2eContext;
  operatorCredentials: OperatorCredentials;
  livePage: Page;
}

export const test = base.extend<AnvilFixtures>({
  e2eContext: async ({}, use) => {
    const contextPath = process.env.ANVIL_E2E_CONTEXT_PATH!;
    const raw = await readFile(contextPath, "utf8");
    use(JSON.parse(raw) as E2eContext);
  },

  operatorCredentials: async ({}, use) => {
    use(OPERATOR_CREDENTIALS);
  },

  // A page with localStorage forced to "live" auth mode before any navigation.
  livePage: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("anvil.auth.mode", "live");
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";

export async function loginViaUi(page: Page, credentials: OperatorCredentials): Promise<void> {
  await page.goto("/app/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/app/projects");
}
