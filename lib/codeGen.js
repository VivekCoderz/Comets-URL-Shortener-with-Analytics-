import { randomBytes } from "node:crypto";

// Short codes: 7 characters from a-z and 0-9 (PRD FR-03).
// 36^7 ≈ 78 billion possible codes, so clashes are rare, and the route
// retries when one happens anyway.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 characters
export const CODE_LENGTH = 7;

// A random byte is 0–255. 256 is not a multiple of 36, so `byte % 36` would
// pick the first few characters slightly more often. 252 (= 7 × 36) is the
// biggest multiple of 36 below 256, so we throw away bytes 252–255.
const LIMIT = 252;

// crypto.randomBytes, not Math.random: Math.random is predictable, so someone
// could guess the next codes and find other people's links.
export function generateCode(length = CODE_LENGTH) {
  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < LIMIT && code.length < length) {
        code += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return code;
}
