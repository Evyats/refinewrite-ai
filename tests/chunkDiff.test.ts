import { describe, expect, it } from 'vitest';
import { granularizeChunks } from '../utils/chunkDiff';

describe('granularizeChunks', () => {
  it('preserves unchanged chunks', () => {
    const chunks = [{ t: 'hello world', o: null }];
    expect(granularizeChunks(chunks)).toEqual(chunks);
  });

  it('splits changed chunks into mixed changed and unchanged segments', () => {
    const chunks = [{ t: 'hello my name is evyatar.', o: 'helllo my name iss evyatar .' }];
    const result = granularizeChunks(chunks);
    expect(result.map((chunk) => chunk.t).join('')).toBe('hello my name is evyatar.');
    expect(result.some((chunk) => chunk.o !== null)).toBe(true);
    expect(result.some((chunk) => chunk.o === null)).toBe(true);
  });
});
