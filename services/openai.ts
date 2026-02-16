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

export const refineTextStream = async (
  text: string,
  type: RefinementType,
  onChunk: (chunks: RefinementChunk[]) => void,
  customInstruction?: string,
  onDebugEvent?: (event: string, payload?: unknown) => void
): Promise<void> => {
  onDebugEvent?.('request_start', {
    type,
    textLength: text.length,
    customInstructionLength: customInstruction?.length || 0,
    startedAt: new Date().toISOString(),
  });

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

  onDebugEvent?.('response_status', { status: response.status, ok: response.ok });

  if (!response.ok) {
    let message = `Refinement failed with status ${response.status}.`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // Keep generic error.
    }
    onDebugEvent?.('client_error', { message });
    throw new Error(message);
  }

  if (!response.body) {
    onDebugEvent?.('client_error', { message: 'Refinement stream is unavailable.' });
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
      onDebugEvent?.('sse_event', { event: evt.event });

      if (evt.event === 'chunks' && Array.isArray(evt.data?.chunks)) {
        onChunk(evt.data.chunks as RefinementChunk[]);
        onDebugEvent?.('chunk_update', { chunkCount: evt.data.chunks.length, chunks: evt.data.chunks });
      }

      if (evt.event === 'error') {
        onDebugEvent?.('client_error', { message: evt.data?.message || 'Refinement failed.' });
        throw new Error(evt.data?.message || 'Refinement failed.');
      }

      if (evt.event === 'done') {
        onDebugEvent?.('done');
        return;
      }
    }
  }

  onDebugEvent?.('done');
};
