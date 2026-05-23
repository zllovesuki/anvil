import { expect, test as base, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  E2E_BASELINE_EMAIL,
  E2E_BASELINE_NAME,
  E2E_BASELINE_SLUG,
  E2E_BASELINE_TESSERA_SUB,
  setMockOidcIdentity,
  type MockIdentity,
} from "../../helpers/oidc-mock";
import type { E2eContext } from "../global-setup";

export interface OperatorIdentity extends MockIdentity {
  displayName: string;
  slug: string;
}

const OPERATOR_IDENTITY: OperatorIdentity = {
  sub: E2E_BASELINE_TESSERA_SUB,
  email: E2E_BASELINE_EMAIL,
  email_verified: true,
  name: E2E_BASELINE_NAME,
  displayName: E2E_BASELINE_NAME,
  slug: E2E_BASELINE_SLUG,
};

export const LOGIN_URL_PATTERN = /\/app\/login(?:[?#]|$)/u;

interface AnvilFixtures {
  e2eContext: E2eContext;
  operatorIdentity: OperatorIdentity;
  livePage: Page;
}

export const test = base.extend<AnvilFixtures>({
  e2eContext: async ({}, use) => {
    const contextPath = process.env.ANVIL_E2E_CONTEXT_PATH!;
    const raw = await readFile(contextPath, "utf8");
    use(JSON.parse(raw) as E2eContext);
  },

  operatorIdentity: async ({}, use) => {
    use(OPERATOR_IDENTITY);
  },

  livePage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };

export async function loginViaUi(
  page: Page,
  e2eContext: E2eContext,
  identity: OperatorIdentity = OPERATOR_IDENTITY,
): Promise<void> {
  await setMockOidcIdentity(e2eContext.oidcIssuer, identity);
  await page.goto("/app/login");
  const signInButton = page.getByRole("button", { name: "Sign in with tessera" });
  await expect(signInButton).toBeEnabled({ timeout: 15_000 });
  await signInButton.click();
  await page.waitForURL(/\/app\/projects(?:[?#]|$)/u);
}
