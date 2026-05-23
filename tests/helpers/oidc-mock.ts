import { OIDCMockProvider, type OIDCMockProviderConfig } from "@mongodb-js/oidc-mock-provider";
import type { IncomingMessage, ServerResponse } from "node:http";

export const TEST_OIDC_CLIENT_ID = "anvil-e2e";
export const TEST_OIDC_CLIENT_SECRET = "anvil-e2e-tessera-secret";

export const E2E_BASELINE_TESSERA_SUB = "e2e-baseline-sub";
export const E2E_BASELINE_EMAIL = "e2e-operator@example.com";
export const E2E_BASELINE_NAME = "E2E Operator";
export const E2E_BASELINE_SLUG = "e2e-operator";

export interface MockIdentity {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}

export interface MockOidcServer {
  issuer: string;
  close(): Promise<void>;
}

const BASELINE_IDENTITY: MockIdentity = {
  sub: E2E_BASELINE_TESSERA_SUB,
  email: E2E_BASELINE_EMAIL,
  email_verified: true,
  name: E2E_BASELINE_NAME,
};

let nextIdentity: MockIdentity | null = null;

const selectIdentity = (): MockIdentity => {
  if (!nextIdentity) {
    return BASELINE_IDENTITY;
  }

  const identity = nextIdentity;
  nextIdentity = null;
  return identity;
};

const handleControlRoute = (url: string, req: IncomingMessage, res: ServerResponse): void => {
  if (!url.includes("/__test/")) return;

  const parsed = new URL(url);
  if (parsed.pathname !== "/__test/identity") return;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const sub = parsed.searchParams.get("sub");
  const email = parsed.searchParams.get("email");
  const name = parsed.searchParams.get("name") ?? undefined;
  const emailVerified = parsed.searchParams.get("email_verified") !== "false";

  if (!sub || !email) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid_identity" }));
    return;
  }

  nextIdentity = { sub, email, email_verified: emailVerified, name };
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};

export const startMockOidcProvider = async (): Promise<MockOidcServer> => {
  const config: OIDCMockProviderConfig = {
    hostname: "127.0.0.1",
    getTokenPayload: () => {
      const identity = selectIdentity();
      return {
        expires_in: 3600,
        payload: { sub: identity.sub, scope: "openid email profile" },
        customIdTokenPayload: {
          sub: identity.sub,
          email: identity.email,
          email_verified: identity.email_verified !== false,
          name: identity.name,
        },
      };
    },
    overrideRequestHandler: handleControlRoute,
  };
  const provider = await OIDCMockProvider.create(config);
  return {
    issuer: provider.issuer,
    close: () => provider.close(),
  };
};

export const setMockOidcIdentity = async (issuer: string, identity: MockIdentity): Promise<void> => {
  const params = new URLSearchParams({
    sub: identity.sub,
    email: identity.email,
    email_verified: identity.email_verified === false ? "false" : "true",
  });
  if (identity.name) {
    params.set("name", identity.name);
  }

  const response = await fetch(`${issuer}/__test/identity?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to configure mock OIDC identity: ${response.status} ${await response.text()}`);
  }
};
