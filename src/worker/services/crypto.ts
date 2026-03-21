export const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  const lengthsMatch = left.byteLength === right.byteLength;
  // subtle.timingSafeEqual throws when inputs differ in length.
  // Compare left against itself to keep execution time constant, then
  // negate to produce the expected false for mismatched lengths.
  return lengthsMatch ? crypto.subtle.timingSafeEqual(left, right) : !crypto.subtle.timingSafeEqual(left, left);
};

export const encodeHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
