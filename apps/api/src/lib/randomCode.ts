import crypto from 'node:crypto';

/** Avoids 0, 1, i, l and o so codes are easier to read aloud and type from screenshots. */
export const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A random code from CODE_ALPHABET. Rejection sampling makes every character equally likely. */
export function randomCode(length: number): string {
  const limit = 256 - (256 % CODE_ALPHABET.length); // 248 for this 31-character alphabet
  let out = '';

  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === length) break;
    }
  }

  return out;
}
