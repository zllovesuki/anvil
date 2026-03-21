const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE62_WIDTH = 22;
const BASE62_LOOKUP = new Map(BASE62_ALPHABET.split("").map((character, index) => [character, BigInt(index)]));

export type DurableEntityPrefix = "usr" | "prj" | "run" | "inv" | "whk";

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
};

const toBase62 = (value: bigint): string => {
  if (value === 0n) {
    return BASE62_ALPHABET[0].repeat(BASE62_WIDTH);
  }

  let remainderValue = value;
  let output = "";

  while (remainderValue > 0n) {
    const remainder = Number(remainderValue % 62n);
    output = `${BASE62_ALPHABET[remainder]}${output}`;
    remainderValue /= 62n;
  }

  return output.padStart(BASE62_WIDTH, BASE62_ALPHABET[0]);
};

const fromBase62 = (value: string): bigint => {
  let output = 0n;

  for (const character of value) {
    const digit = BASE62_LOOKUP.get(character);
    if (digit === undefined) {
      throw new Error("Invalid base62 value.");
    }

    output = output * 62n + digit;
  }

  return output;
};

const createUuidV7Bytes = (timestampMs: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  const randomness = crypto.getRandomValues(new Uint8Array(10));
  let remainingTimestamp = BigInt(timestampMs);

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(remainingTimestamp & 0xffn);
    remainingTimestamp >>= 8n;
  }

  bytes[6] = 0x70 | (randomness[0] & 0x0f);
  bytes[7] = randomness[1];
  bytes[8] = 0x80 | (randomness[2] & 0x3f);
  bytes.set(randomness.slice(3), 9);

  return bytes;
};

export const generateDurableEntityId = (prefix: DurableEntityPrefix, timestampMs = Date.now()): string => {
  const suffix = toBase62(bytesToBigInt(createUuidV7Bytes(timestampMs)));
  return `${prefix}_${suffix}`;
};

export const generateOpaqueToken = (byteLength: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

export const hashSha256 = async (value: string): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
};

export const extractTimestampFromDurableEntityId = (id: string): number | null => {
  const separatorIndex = id.indexOf("_");
  if (separatorIndex === -1) {
    return null;
  }

  const suffix = id.slice(separatorIndex + 1);
  if (suffix.length !== BASE62_WIDTH) {
    return null;
  }

  try {
    const value = fromBase62(suffix);
    const bytes = new Uint8Array(16);
    let remainder = value;

    for (let index = 15; index >= 0; index -= 1) {
      bytes[index] = Number(remainder & 0xffn);
      remainder >>= 8n;
    }

    let timestamp = 0n;
    for (let index = 0; index < 6; index += 1) {
      timestamp = (timestamp << 8n) | BigInt(bytes[index]);
    }

    return Number(timestamp);
  } catch {
    return null;
  }
};
