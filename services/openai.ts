import { RefinementChunk, RefinementType } from '../types';
import { deterministicPrettier } from './prettier';

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

const parseSseEvents = (buffer: string): { parsed: ParsedSseEvent[]; remaining: string } => {
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
        return { event, data: JSON.parse(dataText) } as ParsedSseEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is ParsedSseEvent => event !== null);

  return { parsed, remaining };
};

export const refineTextStream = async (
  text: string,
  type: RefinementType,
  onChunk: (chunks: RefinementChunk[]) => void,
  customInstruction?: string
): Promise<void> => {
  if (type === RefinementType.PRETTIER) {
    const prettified = deterministicPrettier(text);
    const chunks: RefinementChunk[] =
      prettified === text ? [{ t: text, o: null }] : [{ t: prettified, o: text }];

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
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
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
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { parsed, remaining } = parseSseEvents(buffer);
    buffer = remaining;

    for (const event of parsed) {
      if (event.event === 'chunks') {
        const data = event.data as { chunks?: RefinementChunk[] };
        if (Array.isArray(data?.chunks)) {
          onChunk(data.chunks);
        }
      }

      if (event.event === 'error') {
        const data = event.data as { message?: string };
        throw new Error(data?.message || 'Refinement failed.');
      }

      if (event.event === 'done') {
        return;
      }
    }
  }
};

export { deterministicPrettier };
