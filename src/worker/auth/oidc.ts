import * as oidc from "openid-client";
import type { AuthorizationCodeGrantChecks, Configuration, DiscoveryRequestOptions, IDToken } from "openid-client";

import { decodeBase64Url, encodeBase64Url } from "@/worker/services/crypto";

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const HKDF_INFO = textEncoder.encode("anvil-oidc-transaction-v1");

export const OIDC_TX_COOKIE_NAME = "anvil_oidc_tx";
export const OIDC_TX_COOKIE = `__Host-${OIDC_TX_COOKIE_NAME}`;
export const OIDC_TX_COOKIE_MAX_AGE_SECONDS = 5 * 60;
export const OIDC_RETURN_MARKER = "oidc";
export const OIDC_SCOPE = "openid email profile";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface OidcConfigEnv {
  TESSERA_OIDC_ISSUER?: string;
  TESSERA_OIDC_CLIENT_ID?: string;
  TESSERA_OIDC_CLIENT_SECRET?: string;
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export interface TxCookiePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
}

export interface ResolvedClaims {
  sub: string;
  email: string;
  email_verified: true;
  name?: string;
  preferredUsername?: string;
}

export type ClaimValidation = { ok: true; claims: ResolvedClaims } | { ok: false; code: "oidc_unverified_email" };

interface DiscoveryCacheEntry {
  promise: Promise<Configuration>;
  expiresAt: number;
}

type AuthorizationCodeGrantImpl = (
  config: Configuration,
  url: URL,
  checks: AuthorizationCodeGrantChecks,
) => Promise<{ claims(): IDToken | undefined }>;

const discoveryCache = new Map<string, DiscoveryCacheEntry>();
let testConfigOverride: { issuer: string; config: Configuration } | null = null;
let testAuthorizationCodeGrantImpl: AuthorizationCodeGrantImpl | null = null;

export const isLoopbackHostname = (hostname: string): boolean => LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());

export const validateIssuerUrl = (rawIssuer: string | undefined): URL => {
  if (!rawIssuer) {
    throw new Error("TESSERA_OIDC_ISSUER is required");
  }

  const trimmed = rawIssuer.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`TESSERA_OIDC_ISSUER is not a valid URL: ${rawIssuer}`);
  }

  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`TESSERA_OIDC_ISSUER must be an issuer URL without credentials, query, or fragment: ${rawIssuer}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`TESSERA_OIDC_ISSUER must use http(s): ${rawIssuer}`);
  }

  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error(`TESSERA_OIDC_ISSUER must use https unless loopback: ${rawIssuer}`);
  }

  return url;
};

export const loadOidcSettings = (env: OidcConfigEnv): OidcSettings => {
  const issuer = validateIssuerUrl(env.TESSERA_OIDC_ISSUER).toString();
  const clientId = env.TESSERA_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.TESSERA_OIDC_CLIENT_SECRET?.trim();

  if (!clientId) {
    throw new Error("TESSERA_OIDC_CLIENT_ID is required");
  }

  if (!clientSecret) {
    throw new Error("TESSERA_OIDC_CLIENT_SECRET is required");
  }

  return { issuer, clientId, clientSecret };
};

const isAllowedEndpoint = (raw: string | undefined, issuerUrl: URL): boolean => {
  if (!raw) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.hash || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return false;
  }

  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    return false;
  }

  return url.hostname === issuerUrl.hostname;
};

const discoveryOptions = (issuerUrl: URL): DiscoveryRequestOptions =>
  issuerUrl.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : {};

export const getOidcConfig = async (env: OidcConfigEnv): Promise<Configuration> => {
  const settings = loadOidcSettings(env);
  const issuerUrl = new URL(settings.issuer);

  if (testConfigOverride && testConfigOverride.issuer === settings.issuer) {
    return testConfigOverride.config;
  }

  const now = Date.now();
  const cached = discoveryCache.get(settings.issuer);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = oidc
    .discovery(
      issuerUrl,
      settings.clientId,
      undefined,
      oidc.ClientSecretPost(settings.clientSecret),
      discoveryOptions(issuerUrl),
    )
    .then((config) => {
      const metadata = config.serverMetadata();
      if (
        !isAllowedEndpoint(metadata.authorization_endpoint, issuerUrl) ||
        !isAllowedEndpoint(metadata.token_endpoint, issuerUrl) ||
        !isAllowedEndpoint(metadata.jwks_uri, issuerUrl)
      ) {
        throw new Error("OIDC discovery returned an invalid endpoint.");
      }

      return config;
    });

  promise.catch(() => {
    const current = discoveryCache.get(settings.issuer);
    if (current?.promise === promise) {
      discoveryCache.delete(settings.issuer);
    }
  });

  discoveryCache.set(settings.issuer, { promise, expiresAt: now + DISCOVERY_TTL_MS });
  return promise;
};

export const exchangeAuthorizationCode = async (
  config: Configuration,
  url: URL,
  checks: AuthorizationCodeGrantChecks,
): Promise<{ claims(): IDToken | undefined }> => {
  if (testAuthorizationCodeGrantImpl) {
    return await testAuthorizationCodeGrantImpl(config, url, checks);
  }

  return await oidc.authorizationCodeGrant(config, url, checks);
};

export const validateClaims = (raw: IDToken | undefined): ClaimValidation => {
  if (!raw) {
    return { ok: false, code: "oidc_unverified_email" };
  }

  const sub = typeof raw.sub === "string" ? raw.sub.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : undefined;
  const preferredUsername =
    typeof raw.preferred_username === "string" && raw.preferred_username.trim().length > 0
      ? raw.preferred_username.trim()
      : undefined;

  if (!sub || !email || raw.email_verified !== true) {
    return { ok: false, code: "oidc_unverified_email" };
  }

  return {
    ok: true,
    claims: {
      sub,
      email,
      email_verified: true,
      name,
      preferredUsername,
    },
  };
};

const isTxCookiePayload = (value: Partial<TxCookiePayload>): value is TxCookiePayload =>
  typeof value.state === "string" &&
  typeof value.nonce === "string" &&
  typeof value.codeVerifier === "string" &&
  typeof value.redirectUri === "string" &&
  typeof value.returnTo === "string" &&
  typeof value.createdAt === "number";

export const encodeTxCookiePayload = (payload: TxCookiePayload): string =>
  encodeBase64Url(textEncoder.encode(JSON.stringify(payload)));

export const decodeTxCookiePayload = (cookieValue: string | false | undefined): TxCookiePayload | null => {
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(textDecoder.decode(decodeBase64Url(cookieValue))) as Partial<TxCookiePayload>;
    if (!isTxCookiePayload(parsed)) {
      return null;
    }

    if (Date.now() - parsed.createdAt > OIDC_TX_COOKIE_MAX_AGE_SECONDS * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const deriveTxCookieSecret = async (clientSecret: string): Promise<ArrayBuffer> => {
  const baseKey = await crypto.subtle.importKey("raw", textEncoder.encode(clientSecret), "HKDF", false, ["deriveBits"]);
  return await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: HKDF_INFO },
    baseKey,
    256,
  );
};

export const getTxCookieSecret = async (env: OidcConfigEnv): Promise<ArrayBuffer> => {
  const { clientSecret } = loadOidcSettings(env);
  return await deriveTxCookieSecret(clientSecret);
};

export const sanitizeReturnTo = (raw: string | undefined): string => {
  if (!raw) {
    return "/app/projects";
  }

  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    return "/app/projects";
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return "/app/projects";
    }
  }

  return value;
};

export const appendOidcMarker = (path: string): string => {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);

  params.set(OIDC_RETURN_MARKER, "1");
  return `${pathname}?${params.toString()}${hash}`;
};

export const oidcErrorContext = (error: unknown, env?: OidcConfigEnv): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  const issuer = env?.TESSERA_OIDC_ISSUER?.trim();
  if (issuer) {
    fields.configuredIssuer = issuer;
  }

  if (error instanceof Error) {
    fields.errorName = error.name;
    fields.errorMessage = error.message;
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      fields.errorCode = code;
    }
    if (error.cause instanceof Error) {
      fields.causeErrorName = error.cause.name;
      fields.causeErrorMessage = error.cause.message;
    }
  } else {
    fields.errorMessage = String(error);
  }

  return fields;
};

export const __test = {
  setProviderForTesting(issuer: string, config: Configuration): void {
    testConfigOverride = { issuer: validateIssuerUrl(issuer).toString(), config };
  },
  setAuthorizationCodeGrantImpl(fn: AuthorizationCodeGrantImpl | null): void {
    testAuthorizationCodeGrantImpl = fn;
  },
  clear(): void {
    testConfigOverride = null;
    testAuthorizationCodeGrantImpl = null;
    discoveryCache.clear();
  },
};
