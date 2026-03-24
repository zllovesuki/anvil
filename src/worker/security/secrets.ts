import { HttpError } from "@/worker/http";
import { getConfig } from "@/worker/config";
import { toArrayBuffer } from "@/worker/services/crypto";

const AES_GCM_ALGORITHM = "AES-GCM";
const AES_GCM_NONCE_BYTES = 12;
const AES_256_KEY_BYTES = 32;

interface EncryptionKeyConfig {
  currentVersion: number;
  keys: Map<number, string>;
}

export interface EncryptedSecret {
  ciphertext: Uint8Array;
  keyVersion: number;
  nonce: Uint8Array;
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

const encryptionNotConfigured = (message = "Repository token encryption is not configured."): HttpError =>
  new HttpError(500, "encryption_not_configured", message);

const decodeBase64 = (value: string): Uint8Array => {
  let normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");

  const remainder = normalized.length % 4;
  if (remainder > 0) {
    normalized = normalized.padEnd(normalized.length + (4 - remainder), "=");
  }

  const binary = atob(normalized);
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }

  return output;
};

const readEncryptionConfig = (env: Env): EncryptionKeyConfig => {
  const config = getConfig(env);

  if (!Number.isInteger(config.appEncryptionKeyCurrentVersion) || config.appEncryptionKeyCurrentVersion <= 0) {
    throw encryptionNotConfigured();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(config.appEncryptionKeysJson) as unknown;
  } catch {
    throw encryptionNotConfigured();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw encryptionNotConfigured();
  }

  const keys = new Map<number, string>();

  for (const [versionText, encodedKey] of Object.entries(parsed)) {
    const version = Number(versionText);
    if (!Number.isInteger(version) || version <= 0 || typeof encodedKey !== "string") {
      throw encryptionNotConfigured();
    }

    keys.set(version, encodedKey);
  }

  if (!keys.has(config.appEncryptionKeyCurrentVersion)) {
    throw encryptionNotConfigured();
  }

  return {
    currentVersion: config.appEncryptionKeyCurrentVersion,
    keys,
  };
};

const importAesKey = async (encodedKey: string): Promise<CryptoKey> => {
  let pendingKey = importedKeys.get(encodedKey);

  if (!pendingKey) {
    pendingKey = (async () => {
      let rawKey: Uint8Array;
      try {
        rawKey = decodeBase64(encodedKey);
      } catch {
        throw encryptionNotConfigured();
      }

      if (rawKey.byteLength !== AES_256_KEY_BYTES) {
        throw encryptionNotConfigured();
      }

      try {
        return await crypto.subtle.importKey("raw", toArrayBuffer(rawKey), { name: AES_GCM_ALGORITHM }, false, [
          "encrypt",
          "decrypt",
        ]);
      } catch {
        throw encryptionNotConfigured();
      }
    })();

    importedKeys.set(encodedKey, pendingKey);
  }

  try {
    return await pendingKey;
  } catch (error) {
    importedKeys.delete(encodedKey);
    throw error;
  }
};

const importVersionedKey = async (env: Env, version: number): Promise<CryptoKey> => {
  const config = readEncryptionConfig(env);
  const encodedKey = config.keys.get(version);

  if (!encodedKey) {
    throw encryptionNotConfigured();
  }

  return importAesKey(encodedKey);
};

export const validateAppEncryptionConfig = async (env: Env): Promise<void> => {
  const config = readEncryptionConfig(env);

  await Promise.all([...config.keys.values()].map((encodedKey) => importAesKey(encodedKey)));
};

export const encryptSecret = async (env: Env, plaintext: string): Promise<EncryptedSecret> => {
  if (plaintext.length === 0) {
    throw new HttpError(400, "invalid_repo_token", "Repository token cannot be empty.");
  }

  const config = readEncryptionConfig(env);
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const key = await importVersionedKey(env, config.currentVersion);
  const encodedPlaintext = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: AES_GCM_ALGORITHM,
      iv: toArrayBuffer(nonce),
    },
    key,
    encodedPlaintext,
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    keyVersion: config.currentVersion,
    nonce,
  };
};

export const decryptSecret = async (env: Env, encryptedSecret: EncryptedSecret): Promise<string> => {
  const key = await importVersionedKey(env, encryptedSecret.keyVersion);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: AES_GCM_ALGORITHM,
        iv: toArrayBuffer(encryptedSecret.nonce),
      },
      key,
      toArrayBuffer(encryptedSecret.ciphertext),
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw encryptionNotConfigured("Stored repository token could not be decrypted.");
  }
};
