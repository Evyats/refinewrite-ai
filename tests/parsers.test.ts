import { describe, expect, it } from 'vitest';
import { extractCompleteObjects, sanitizeChunks } from '../server/parsers';

describe('server parsers', () => {
  it('extracts complete json objects from partial stream', () => {
    const input = '{"t":"hello","o":null}{"t":" world","o":" wrld"}{"t":"x"';
    const objects = extractCompleteObjects(input);
    expect(objects).toEqual(['{"t":"hello","o":null}', '{"t":" world","o":" wrld"}']);
  });

  it('sanitizes invalid chunk entries', () => {
    const result = sanitizeChunks([
      { t: 'ok', o: null },
      { t: 'x', o: 'y' },
      { t: 1, o: null },
      { t: 'bad', o: 9 },
      null,
    ]);

    expect(result).toEqual([
      { t: 'ok', o: null },
      { t: 'x', o: 'y' },
    ]);
  });
});
