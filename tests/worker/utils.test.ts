import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { buildGitCheckoutAuth, redactSecrets } from "@/worker/sandbox/git";
import { decryptSecret, encryptSecret } from "@/worker/security/secrets";

import { registerWorkerRuntimeHooks } from "../helpers/worker-hooks";

describe("worker utilities", () => {
  registerWorkerRuntimeHooks();

  it("round-trips encrypted secrets with the test app key", async () => {
    const encrypted = await encryptSecret(env, "super-secret-token");
    const decrypted = await decryptSecret(env, encrypted);

    expect(decrypted).toBe("super-secret-token");
  });

  it("builds provider-specific git auth headers and redacts secrets", () => {
    const github = buildGitCheckoutAuth("https://github.com/example/repo", "ghp_secret");
    const gitlab = buildGitCheckoutAuth("https://gitlab.com/example/repo", "glpat-secret");
    const custom = buildGitCheckoutAuth("https://codeberg.org/example/repo", "builder:token-123");

    expect(github.hasAuthHeader).toBe(true);
    expect(github.sessionEnv.ANVIL_GIT_AUTH_HEADER).toContain("Basic");
    expect(github.redactionSecrets).toContain("ghp_secret");

    expect(gitlab.hasAuthHeader).toBe(true);
    expect(gitlab.redactionSecrets).toContain("glpat-secret");

    expect(custom.hasAuthHeader).toBe(true);
    expect(custom.redactionSecrets).toContain("builder:token-123");
    expect(custom.redactionSecrets).toContain("token-123");

    expect(redactSecrets("token-123 and ghp_secret", [...custom.redactionSecrets, ...github.redactionSecrets])).toBe(
      "[REDACTED] and [REDACTED]",
    );
  });
});
