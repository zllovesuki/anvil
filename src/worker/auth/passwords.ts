import { timingSafeEqual } from "@/worker/services/crypto";

const KEY_LENGTH_BITS = 256;

export interface PasswordHashResult {
  algorithm: "PBKDF2";
  digest: string;
  iterations: number;
  salt: Uint8Array;
  passwordHash: Uint8Array;
}

const importPasswordKey = async (password: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);

const derivePasswordHash = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
  digest: string,
): Promise<Uint8Array> => {
  const key = await importPasswordKey(password);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: digest,
      salt: salt as BufferSource,
      iterations,
    },
    key,
    KEY_LENGTH_BITS,
  );

  return new Uint8Array(bits);
};

export const hashPassword = async (password: string, env: Env): Promise<PasswordHashResult> => {
  const digest = env.PASSWORD_PBKDF2_DIGEST;
  const iterations = Number(env.PASSWORD_PBKDF2_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePasswordHash(password, salt, iterations, digest);

  return {
    algorithm: "PBKDF2",
    digest,
    iterations,
    salt,
    passwordHash,
  };
};

export const verifyPassword = async (
  password: string,
  stored: {
    digest: string;
    iterations: number;
    salt: Uint8Array;
    passwordHash: Uint8Array;
  },
): Promise<boolean> => {
  const candidateHash = await derivePasswordHash(password, stored.salt, stored.iterations, stored.digest);

  return timingSafeEqual(candidateHash, stored.passwordHash);
};
