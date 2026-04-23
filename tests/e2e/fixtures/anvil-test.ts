import { expect, test as base, type Page } from "@playwright/test";
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
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

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
    await stubTurnstile(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("anvil.auth.mode", "live");
    });
    await use(page);
  },
});

export { expect };

async function stubTurnstile(page: Page, token = "e2e-turnstile-token"): Promise<void> {
  await page.route(TURNSTILE_SCRIPT_URL, async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
(() => {
  const issuedToken = ${JSON.stringify(token)};
  let counter = 0;
  const widgets = new Map();

  window.turnstile = {
    render(container, options) {
      const widgetId = \`widget-\${++counter}\`;
      const host = document.createElement("div");
      host.setAttribute("data-e2e-turnstile", options.action ?? "");
      host.textContent = "E2E Turnstile";
      container.replaceChildren(host);
      widgets.set(widgetId, { container, options });
      Promise.resolve().then(() => options.callback(issuedToken));
      return widgetId;
    },
    reset(widgetId) {
      const widget = widgets.get(widgetId);
      if (widget) {
        Promise.resolve().then(() => widget.options.callback(issuedToken));
      }
    },
    remove(widgetId) {
      const widget = widgets.get(widgetId);
      if (widget) {
        widget.container.replaceChildren();
        widgets.delete(widgetId);
      }
    },
  };
})();
      `,
    });
  });
}

export async function loginViaUi(page: Page, credentials: OperatorCredentials): Promise<void> {
  await page.goto("/app/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  const signInButton = page.getByRole("button", { name: "Sign In" });
  await expect(signInButton).toBeEnabled({ timeout: 15_000 });
  await signInButton.click();
  await page.waitForURL("**/app/projects");
}
