import { describe, expect, it } from 'vitest';
import { deterministicPrettier } from '../services/prettier';

describe('deterministicPrettier', () => {
  it('normalizes whitespace and sentence capitalization', () => {
    const input = 'hello   world .this is test!  okay?';
    const output = deterministicPrettier(input);
    expect(output).toBe('Hello world. This is test! Okay?');
  });

  it('keeps line breaks and normalizes spacing per line', () => {
    const input = 'first line\nsecond   line';
    const output = deterministicPrettier(input);
    expect(output).toBe('First line\nsecond line');
  });
});
