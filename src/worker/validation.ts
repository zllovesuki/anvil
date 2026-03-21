import { HttpError } from "@/worker/http";
import { BranchName, MIN_PASSWORD_LENGTH, type BranchName as BranchNameType } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/u;
const IPV4_HOST_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const DNS_HOST_PATTERN = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(?:\.(?!-)[A-Za-z0-9-]+)+$/u;

export const assertValidSlug = (value: string, fieldName: string): void => {
  if (!SLUG_PATTERN.test(value)) {
    throw new HttpError(
      400,
      "invalid_slug",
      `${fieldName} must use only alphanumeric, hyphen, or underscore characters.`,
    );
  }
};

const assertNonEmptyTrimmedString = (value: string, fieldName: string): string => {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new HttpError(400, "invalid_request", `${fieldName} cannot be empty.`);
  }

  return trimmedValue;
};

export const normalizeEmailAddress = (value: string): string =>
  assertNonEmptyTrimmedString(value, "email").toLowerCase();

export const normalizeDisplayName = (value: string): string => assertNonEmptyTrimmedString(value, "displayName");

export const assertValidPassword = (value: string): void => {
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, "invalid_password", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
};

const isIpLiteralHost = (hostname: string): boolean => IPV4_HOST_PATTERN.test(hostname) || hostname.includes(":");

const normalizePublicHttpsUrl = (
  value: string,
  fieldName: string,
  options: {
    requirePath: boolean;
    stripGitSuffix: boolean;
  },
): string => {
  const rawValue = assertNonEmptyTrimmedString(value, fieldName);
  let url: URL;

  try {
    url = new URL(rawValue);
  } catch (error) {
    throw new HttpError(400, "invalid_request", `${fieldName} must be a valid HTTPS URL.`, error);
  }

  if (url.protocol !== "https:") {
    throw new HttpError(400, "invalid_request", `${fieldName} must use https://.`);
  }

  if (url.username || url.password) {
    throw new HttpError(400, "invalid_request", `${fieldName} cannot include embedded credentials.`);
  }

  if (url.search || url.hash) {
    throw new HttpError(400, "invalid_request", `${fieldName} cannot include a query string or fragment.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    isIpLiteralHost(hostname) ||
    !DNS_HOST_PATTERN.test(hostname)
  ) {
    throw new HttpError(400, "invalid_request", `${fieldName} must use a public DNS hostname.`);
  }

  let normalizedPathname = url.pathname.replace(/\/+$/u, "");
  if (options.stripGitSuffix && normalizedPathname.endsWith(".git")) {
    normalizedPathname = normalizedPathname.slice(0, -4);
  }

  if (options.requirePath && normalizedPathname.length === 0) {
    throw new HttpError(400, "invalid_request", `${fieldName} must include a path.`);
  }

  const host = url.port.length > 0 && url.port !== "443" ? `${hostname}:${url.port}` : hostname;
  return `https://${host}${normalizedPathname}`;
};

export const normalizeRepositoryUrl = (value: string): string => {
  try {
    return normalizePublicHttpsUrl(value, "repoUrl", {
      requirePath: true,
      stripGitSuffix: true,
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "invalid_request") {
      throw new HttpError(400, "invalid_repo_url", error.message, error.details);
    }

    throw error;
  }
};

export const normalizeWebhookInstanceUrl = (value: string): string => {
  try {
    return normalizePublicHttpsUrl(value, "instanceUrl", {
      requirePath: false,
      stripGitSuffix: false,
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "invalid_request") {
      throw new HttpError(400, "invalid_instance_url", error.message, error.details);
    }

    throw error;
  }
};

export const normalizeConfigPath = (value: string): string => {
  const rawValue = assertNonEmptyTrimmedString(value, "configPath");

  if (rawValue.startsWith("/")) {
    throw new HttpError(400, "invalid_config_path", "configPath must be repo-relative.");
  }

  if (rawValue.includes("\\")) {
    throw new HttpError(400, "invalid_config_path", "configPath must use forward slashes.");
  }

  const segments = rawValue.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new HttpError(
      400,
      "invalid_config_path",
      "configPath must be a normalized repo-relative path without traversal.",
    );
  }

  return rawValue;
};

export const normalizeProjectName = (value: string): string => assertNonEmptyTrimmedString(value, "name");

export const normalizeBranchName = (value: string): BranchNameType =>
  expectTrusted(BranchName, assertNonEmptyTrimmedString(value, "defaultBranch"), "BranchName");
