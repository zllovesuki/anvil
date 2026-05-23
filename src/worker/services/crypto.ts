export const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  const lengthsMatch = left.byteLength === right.byteLength;
  // subtle.timingSafeEqual throws when inputs differ in length.
  // Compare left against itself to keep execution time constant, then
  // negate to produce the expected false for mismatched lengths.
  return lengthsMatch ? crypto.subtle.timingSafeEqual(left, right) : !crypto.subtle.timingSafeEqual(left, left);
};

export const encodeHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const encodeBase64 = (value: Uint8Array): string => {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

export const decodeBase64 = (value: string): Uint8Array => {
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

export const encodeBase64Url = (value: Uint8Array): string =>
  encodeBase64(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

export const decodeBase64Url = (value: string): Uint8Array => decodeBase64(value);

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
