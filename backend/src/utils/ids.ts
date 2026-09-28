/**
 * Short, URL-safe, unique-enough ids for search jobs (crypto-random).
 */

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Largest multiple of the alphabet size that fits in a byte: 62 * 4 = 248.
 * Bytes at or above this are rejected so `byte % 62` maps every residue onto
 * the same number of source bytes — without it the modulo is biased (CWE-327).
 */
const UNBIASED_BYTE_LIMIT = 248;

export function shortId(length = 8): string {
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length - out.length);
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      out += ALPHABET.charAt(byte % ALPHABET.length);
      if (out.length === length) break;
    }
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}