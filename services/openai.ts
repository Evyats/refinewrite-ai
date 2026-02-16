import { RefinementType, RefinementChunk } from '../types';

const parseSseEvents = (buffer: string) => {
  const frames = buffer.split('\n\n');
  const remaining = frames.pop() || '';

  const parsed = frames
    .map((frame) => {
      const lines = frame.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLines = lines.filter((line) => line.startsWith('data:'));

      if (!eventLine || dataLines.length === 0) {
        return null;
      }

      const event = eventLine.slice('event:'.length).trim();
      const dataText = dataLines.map((line) => line.slice('data:'.length).trim()).join('\n');

      try {
        return { event, data: JSON.parse(dataText) };
      } catch {
        return null;
      }
    })
    .filter((item): item is { event: string; data: any } => item !== null);

  return { parsed, remaining };
};

const deterministicPrettier = (input: string): string => {
  const normalizedWhitespace = input
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/[ ]+([.,!?;:])/g, '$1')
    .replace(/([.,!?;:])([^\s\n])/g, '$1 $2');

  let result = '';
  let shouldCapitalize = true;

  for (let i = 0; i < normalizedWhitespace.length; i += 1) {
    const ch = normalizedWhitespace[i];
    if (shouldCapitalize && /[a-zA-Z]/.test(ch)) {
      result += ch.toUpperCase();
      shouldCapitalize = false;
      continue;
    }

    result += ch;

    if (/[.!?]/.test(ch)) {
      shouldCapitalize = true;
    }
  }

  return result;
};

export const refineTextStream = async (
  text: string,
  type: RefinementType,
  onChunk: (chunks: RefinementChunk[]) => void,
  customInstruction?: string
): Promise<void> => {
  if (type === RefinementType.PRETTIER) {
    const prettified = deterministicPrettier(text);
    const chunks: RefinementChunk[] = prettified === text
      ? [{ t: text, o: null }]
      : [{ t: prettified, o: text }];

    onChunk(chunks);
    return;
  }

  const response = await fetch('/api/refine', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      type,
      customInstruction,
    }),
  });

  if (!response.ok) {
    let message = `Refinement failed with status ${response.status}.`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // Keep generic error.
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('Refinement stream is unavailable.');
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { parsed, remaining } = parseSseEvents(buffer);
    buffer = remaining;

    for (const evt of parsed) {
      if (evt.event === 'chunks' && Array.isArray(evt.data?.chunks)) {
        onChunk(evt.data.chunks as RefinementChunk[]);
      }

      if (evt.event === 'error') {
        throw new Error(evt.data?.message || 'Refinement failed.');
      }

      if (evt.event === 'done') {
        return;
      }
    }
  }
};
