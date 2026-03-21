export const GIT_AUTH_HEADER_ENV = "ANVIL_GIT_AUTH_HEADER";

export interface GitCheckoutAuth {
  sessionEnv: Record<string, string | undefined>;
  redactionSecrets: string[];
  hasAuthHeader: boolean;
}

const parseCustomProviderUserInfo = (value: string): { username: string; password: string } => {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error("Custom HTTPS repository credentials must use the format username:token.");
  }

  return {
    username: value.slice(0, separatorIndex),
    password: value.slice(separatorIndex + 1),
  };
};

const encodeBase64 = (value: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const buildBasicAuthHeader = (username: string, password: string): string =>
  `Authorization: Basic ${encodeBase64(`${username}:${password}`)}`;

export const buildGitCheckoutAuth = (repoUrl: string, token: string | null): GitCheckoutAuth => {
  if (!token) {
    return {
      sessionEnv: {
        GIT_TERMINAL_PROMPT: "0",
      },
      redactionSecrets: [],
      hasAuthHeader: false,
    };
  }

  const hostname = new URL(repoUrl).hostname.toLowerCase();

  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    const authHeader = buildBasicAuthHeader("x-access-token", token);
    return {
      sessionEnv: {
        GIT_TERMINAL_PROMPT: "0",
        [GIT_AUTH_HEADER_ENV]: authHeader,
      },
      redactionSecrets: [token, authHeader],
      hasAuthHeader: true,
    };
  }

  if (hostname === "gitlab.com" || hostname.endsWith(".gitlab.com")) {
    const authHeader = buildBasicAuthHeader("oauth2", token);
    return {
      sessionEnv: {
        GIT_TERMINAL_PROMPT: "0",
        [GIT_AUTH_HEADER_ENV]: authHeader,
      },
      redactionSecrets: [token, authHeader],
      hasAuthHeader: true,
    };
  }

  const { username, password } = parseCustomProviderUserInfo(token);
  const authHeader = buildBasicAuthHeader(username, password);

  return {
    sessionEnv: {
      GIT_TERMINAL_PROMPT: "0",
      [GIT_AUTH_HEADER_ENV]: authHeader,
    },
    redactionSecrets: [token, password, authHeader],
    hasAuthHeader: true,
  };
};

export const redactSecrets = (value: string, secrets: string[]): string => {
  let output = value;

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }

    output = output.split(secret).join("[REDACTED]");
  }

  return output;
};
