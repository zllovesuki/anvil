import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { buildGitCheckoutAuth, redactSecrets } from "@/worker/sandbox/git";
import { decryptSecret, encryptSecret, validateAppEncryptionConfig } from "@/worker/security/secrets";

import { registerWorkerRuntimeHooks } from "../helpers/worker-hooks";

describe("worker utilities", () => {
  registerWorkerRuntimeHooks();

  const buildEncryptionEnv = (
    overrides: Partial<Pick<Env, "APP_ENCRYPTION_KEY_CURRENT_VERSION" | "APP_ENCRYPTION_KEYS_JSON">>,
  ) =>
    ({
      APP_ENCRYPTION_KEY_CURRENT_VERSION:
        overrides.APP_ENCRYPTION_KEY_CURRENT_VERSION ?? env.APP_ENCRYPTION_KEY_CURRENT_VERSION,
      APP_ENCRYPTION_KEYS_JSON: overrides.APP_ENCRYPTION_KEYS_JSON ?? env.APP_ENCRYPTION_KEYS_JSON,
    }) as unknown as Env;

  it("round-trips encrypted secrets with the test app key", async () => {
    const encrypted = await encryptSecret(env, "super-secret-token");
    const decrypted = await decryptSecret(env, encrypted);

    expect(decrypted).toBe("super-secret-token");
  });

  it("accepts a valid app encryption configuration", async () => {
    await expect(validateAppEncryptionConfig(env)).resolves.toBeUndefined();
  });

  it("rejects a missing current key version", async () => {
    const invalidEnv = buildEncryptionEnv({
      APP_ENCRYPTION_KEYS_JSON: JSON.stringify({
        2: Buffer.alloc(32, 3).toString("base64"),
      }),
    });

    await expect(validateAppEncryptionConfig(invalidEnv)).rejects.toMatchObject({
      code: "encryption_not_configured",
    });
  });

  it("rejects invalid encryption key JSON", async () => {
    const invalidEnv = buildEncryptionEnv({
      APP_ENCRYPTION_KEYS_JSON: "{not-json",
    });

    await expect(validateAppEncryptionConfig(invalidEnv)).rejects.toMatchObject({
      code: "encryption_not_configured",
    });
  });

  it("rejects invalid encryption key material", async () => {
    const invalidEnv = buildEncryptionEnv({
      APP_ENCRYPTION_KEYS_JSON: JSON.stringify({
        1: "not-base64",
      }),
    });

    await expect(validateAppEncryptionConfig(invalidEnv)).rejects.toMatchObject({
      code: "encryption_not_configured",
    });
  });

  it("rejects encryption keys with the wrong length", async () => {
    const invalidEnv = buildEncryptionEnv({
      APP_ENCRYPTION_KEYS_JSON: JSON.stringify({
        1: Buffer.alloc(16, 9).toString("base64"),
      }),
    });

    await expect(validateAppEncryptionConfig(invalidEnv)).rejects.toMatchObject({
      code: "encryption_not_configured",
    });
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
