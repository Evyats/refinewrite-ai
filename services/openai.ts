import { RefinementChunk, RefinementType } from '../types';
import { deterministicPrettier } from './prettier';

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

const logClientApi = (requestId: string, stage: string, details?: unknown) => {
  if (details !== undefined) {
    console.info(`[client:api:${requestId}] ${stage}`, details);
    return;
  }
  console.info(`[client:api:${requestId}] ${stage}`);
};

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
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (type === RefinementType.PRETTIER) {
    const prettified = deterministicPrettier(text);
    const chunks: RefinementChunk[] =
      prettified === text ? [{ t: text, o: null }] : [{ t: prettified, o: text }];

    onChunk(chunks);
    logClientApi(requestId, 'prettier_local_success', {
      type,
      textLength: text.length,
      chunkCount: chunks.length,
    });
    return;
  }

  const requestPayload = {
    text,
    type,
    customInstruction,
  };
  logClientApi(requestId, 'request_start', {
    url: '/api/refine',
    type,
    textLength: text.length,
    customInstructionLength: typeof customInstruction === 'string' ? customInstruction.length : 0,
  });

  let response: Response;
  try {
    response = await fetch('/api/refine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });
  } catch (error) {
    logClientApi(requestId, 'network_error', {
      message: error instanceof Error ? error.message : 'Unknown fetch error',
    });
    throw error;
  }

  logClientApi(requestId, 'response_received', {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    contentType: response.headers.get('content-type') || '(none)',
  });

  if (!response.ok) {
    let message = `Refinement failed with status ${response.status}.`;
    let responseBodyPreview = '';

    try {
      responseBodyPreview = await response.text();
      const payload = JSON.parse(responseBodyPreview) as { error?: string; message?: string };
      if (payload?.error) {
        message = payload.error;
      } else if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Keep generic error if body is non-JSON or unreadable.
    }

    logClientApi(requestId, 'request_failed', {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      message,
      responseBodyPreview: responseBodyPreview.slice(0, 1200),
      request: {
        type,
        textLength: text.length,
        customInstructionLength: typeof customInstruction === 'string' ? customInstruction.length : 0,
      },
    });

    throw new Error(message);
  }

  if (!response.body) {
    logClientApi(requestId, 'missing_response_stream');
    throw new Error('Refinement stream is unavailable.');
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let eventCount = 0;
  let chunkEventCount = 0;

  while (true) {
    let done = false;
    let value: Uint8Array | undefined;
    try {
      const readResult = await reader.read();
      done = readResult.done;
      value = readResult.value;
    } catch (error) {
      logClientApi(requestId, 'stream_read_error', {
        message: error instanceof Error ? error.message : 'Unknown stream read error',
      });
      throw error;
    }
    if (done) {
      logClientApi(requestId, 'stream_ended', {
        eventCount,
        chunkEventCount,
      });
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { parsed, remaining } = parseSseEvents(buffer);
    buffer = remaining;
    eventCount += parsed.length;

    for (const event of parsed) {
      if (event.event === 'chunks') {
        const data = event.data as { chunks?: RefinementChunk[] };
        if (Array.isArray(data?.chunks)) {
          chunkEventCount += 1;
          logClientApi(requestId, 'chunks_event', {
            chunkEventCount,
            chunkCount: data.chunks.length,
          });
          onChunk(data.chunks);
        }
      }

      if (event.event === 'error') {
        const data = event.data as { message?: string };
        logClientApi(requestId, 'sse_error_event', data);
        throw new Error(data?.message || 'Refinement failed.');
      }

      if (event.event === 'done') {
        logClientApi(requestId, 'done_event', {
          eventCount,
          chunkEventCount,
        });
        return;
      }
    }
  }
};

export { deterministicPrettier };
