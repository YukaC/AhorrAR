import { describe, expect, it } from 'vitest';
import { shortId } from '../src/utils/ids.ts';

const ID_ALPHABET = /^[0-9a-zA-Z]+$/;

describe('shortId', () => {
  it('keeps the requested length and only emits alphabet characters', () => {
    for (let i = 0; i < 500; i++) {
      const id = shortId();
      expect(id).toHaveLength(8);
      expect(id).toMatch(ID_ALPHABET);
    }
    for (const length of [1, 4, 16, 32]) {
      const id = shortId(length);
      expect(id).toHaveLength(length);
      expect(id).toMatch(ID_ALPHABET);
    }
  });
});
