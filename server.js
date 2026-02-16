const express = require('express');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const app = express();
const port = process.env.PORT || 8080;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const LLM_REFINEMENT_ENABLED = process.env.LLM_REFINEMENT_ENABLED !== 'false';
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 20000);
const MAX_REQUESTS_PER_MINUTE_PER_IP = Number(process.env.MAX_REQUESTS_PER_MINUTE_PER_IP || 20);
const MAX_REQUESTS_PER_DAY_PER_IP = Number(process.env.MAX_REQUESTS_PER_DAY_PER_IP || 300);
const MIN_INTERVAL_BETWEEN_REQUESTS_MS = Number(process.env.MIN_INTERVAL_BETWEEN_REQUESTS_MS || 500);
const MAX_CONCURRENT_REFINES_PER_IP = Number(process.env.MAX_CONCURRENT_REFINES_PER_IP || 2);
const MAX_CONCURRENT_REFINES_GLOBAL = Number(process.env.MAX_CONCURRENT_REFINES_GLOBAL || 40);

const ALLOWED_TYPES = new Set(['slight', 'prettier', 'revision', 'filler', 'custom']);
const perIpRequestWindow = new Map();
const perIpDailyUsage = new Map();
const perIpActiveRefines = new Map();
const perIpLastRequestAt = new Map();
let activeRefinesGlobal = 0;

app.use(express.json({ limit: '1mb' }));

function getSystemInstruction(type, customInstruction) {
  switch (type) {
    case 'slight':
      return `You are a surgical editor. Perform MINIMAL changes.
Only fix: 1. Blatant spelling/grammar errors. 2. Weakest word choices.
Do NOT change the tone, style, or structure. If a sentence is fine, leave it exactly as is.
Return an array of segments mapping new text to original text if changed.`;
    case 'prettier':
      return 'You are a formatting expert. Only fix capitalization and remove extra spaces. Do not change words. Return an array of segments mapping new text to original text if changed.';
    case 'revision':
      return 'You are an expert writer. Revise for clarity and flow while keeping original intent. Return an array of segments mapping new text to original text if changed.';
    case 'filler':
      return "Identify '___' and fill with context-appropriate words. Return segments where '___' is original text.";
    case 'custom':
      return `Follow: "${customInstruction || ''}". Return an array of segments mapping new text to original text if changed.`;
    default:
      return '';
  }
}

function extractCompleteObjects(source) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function sanitizeChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks
    .filter((item) => item && typeof item.t === 'string' && (typeof item.o === 'string' || item.o === null))
    .map((item) => ({ t: item.t, o: item.o }));
}

function sseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const ips = new Set();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        ips.add(entry.address);
      }
    });
  });

  return Array.from(ips);
}

function extractTextFromResponsePayload(payload) {
  const output = payload?.response?.output;
  if (!Array.isArray(output)) return '';

  let combined = '';
  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (typeof part?.text === 'string') {
        combined += part.text;
      }
    }
  }

  return combined;
}

function normalizeIp(ip) {
  if (!ip) return 'unknown';
  return ip.replace(/^::ffff:/, '');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded.split(',')[0].trim());
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function reserveRefineSlot(ip) {
  const now = Date.now();
  const minuteAgo = now - 60_000;

  const timestamps = (perIpRequestWindow.get(ip) || []).filter((t) => t >= minuteAgo);
  if (timestamps.length >= MAX_REQUESTS_PER_MINUTE_PER_IP) {
    perIpRequestWindow.set(ip, timestamps);
    return { ok: false, status: 429, message: 'Rate limit exceeded for this IP. Please wait and try again.' };
  }

  const lastRequestAt = perIpLastRequestAt.get(ip) || 0;
  if (now - lastRequestAt < MIN_INTERVAL_BETWEEN_REQUESTS_MS) {
    return { ok: false, status: 429, message: 'Requests are too frequent. Please slow down.' };
  }

  const day = todayKey();
  const dailyKey = `${ip}:${day}`;
  const dailyCount = perIpDailyUsage.get(dailyKey) || 0;
  if (dailyCount >= MAX_REQUESTS_PER_DAY_PER_IP) {
    return { ok: false, status: 429, message: 'Daily refine limit reached for this IP.' };
  }

  const activeForIp = perIpActiveRefines.get(ip) || 0;
  if (activeForIp >= MAX_CONCURRENT_REFINES_PER_IP) {
    return { ok: false, status: 429, message: 'Too many concurrent refine requests for this IP.' };
  }

  if (activeRefinesGlobal >= MAX_CONCURRENT_REFINES_GLOBAL) {
    return { ok: false, status: 429, message: 'Server is handling too many concurrent refine requests.' };
  }

  timestamps.push(now);
  perIpRequestWindow.set(ip, timestamps);
  perIpLastRequestAt.set(ip, now);
  perIpDailyUsage.set(dailyKey, dailyCount + 1);
  perIpActiveRefines.set(ip, activeForIp + 1);
  activeRefinesGlobal += 1;

  return { ok: true };
}

function releaseRefineSlot(ip) {
  const activeForIp = perIpActiveRefines.get(ip) || 0;
  if (activeForIp <= 1) {
    perIpActiveRefines.delete(ip);
  } else {
    perIpActiveRefines.set(ip, activeForIp - 1);
  }
  activeRefinesGlobal = Math.max(0, activeRefinesGlobal - 1);
}

app.post('/api/refine', async (req, res) => {
  if (!LLM_REFINEMENT_ENABLED) {
    return res.status(503).json({ error: 'LLM refinement is currently disabled by server configuration.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY server environment variable.' });
  }

  const { text, type, customInstruction } = req.body || {};
  const clientIp = getClientIp(req);

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '"text" must be a non-empty string.' });
  }

  if (text.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ error: `"text" exceeds MAX_INPUT_CHARS (${MAX_INPUT_CHARS}).` });
  }

  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: '"type" must be one of: slight, prettier, revision, filler, custom.' });
  }

  if (type === 'prettier') {
    return res.status(400).json({ error: '"prettier" is deterministic and should run locally, not via /api/refine.' });
  }

  if (type === 'custom' && (typeof customInstruction !== 'string' || !customInstruction.trim())) {
    return res.status(400).json({ error: '"customInstruction" is required for type "custom".' });
  }

  const slot = reserveRefineSlot(clientIp);
  if (!slot.ok) {
    return res.status(slot.status).json({ error: slot.message });
  }
  let slotReleased = false;
  const releaseSlotIfNeeded = () => {
    if (!slotReleased) {
      slotReleased = true;
      releaseRefineSlot(clientIp);
    }
  };

  res.on('close', releaseSlotIfNeeded);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    releaseSlotIfNeeded();
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  const systemInstruction = getSystemInstruction(type, customInstruction);
  const prompt = `Input: "${text}"\nResponse Format: OBJECT: { "chunks": ARRAY of { "t": "new text", "o": "original or null" } }. Every character must be accounted for.`;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        stream: true,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemInstruction }] },
          { role: 'user', content: [{ type: 'input_text', text: prompt }] },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'refinement_chunks',
            schema: {
              type: 'object',
              properties: {
                chunks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      t: { type: 'string' },
                      o: { type: ['string', 'null'] },
                    },
                    required: ['t', 'o'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['chunks'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      }),
    });

    if (!openAiResponse.ok || !openAiResponse.body) {
      const details = await openAiResponse.text();
      console.error(`[refine:${requestId}] openai_error`, {
        status: openAiResponse.status,
        details,
      });
      sseEvent(res, 'error', { message: `OpenAI request failed (${openAiResponse.status}). ${details.slice(0, 500)}` });
      sseEvent(res, 'done', { ok: false });
      return res.end();
    }

    const decoder = new TextDecoder();
    let rawSseBuffer = '';
    let accumulatedOutputText = '';
    const chunks = [];
    let processedObjectCount = 0;

    for await (const part of openAiResponse.body) {
      rawSseBuffer += decoder.decode(part, { stream: true });
      const events = rawSseBuffer.split('\n\n');
      rawSseBuffer = events.pop() || '';

      for (const eventBlock of events) {
        const lines = eventBlock.split('\n');
        const eventLine = lines.find((line) => line.startsWith('event:'));
        const dataLines = lines.filter((line) => line.startsWith('data:'));

        if (!eventLine || dataLines.length === 0) {
          continue;
        }

        const eventName = eventLine.slice('event:'.length).trim();
        const payloadText = dataLines.map((line) => line.slice('data:'.length).trim()).join('\n');

        if (payloadText === '[DONE]') {
          continue;
        }

        let payload;
        try {
          payload = JSON.parse(payloadText);
        } catch {
          continue;
        }

        if (eventName === 'response.output_text.delta' && typeof payload.delta === 'string') {
          accumulatedOutputText += payload.delta;

          const objectStrings = extractCompleteObjects(accumulatedOutputText);
          if (objectStrings.length > processedObjectCount) {
            for (let i = processedObjectCount; i < objectStrings.length; i += 1) {
              try {
                const parsed = JSON.parse(objectStrings[i]);
                if (typeof parsed.t === 'string' && (typeof parsed.o === 'string' || parsed.o === null)) {
                  chunks.push({ t: parsed.t, o: parsed.o });
                  processedObjectCount += 1;
                }
              } catch {
                // Keep waiting for more stable JSON.
              }
            }

            sseEvent(res, 'chunks', { chunks });
          }
        }

        if ((eventName === 'response.completed' || eventName === 'response.output_text.done') && !accumulatedOutputText) {
          const finalText = eventName === 'response.output_text.done'
            ? payload?.text
            : extractTextFromResponsePayload(payload);

          if (typeof finalText === 'string' && finalText) {
            accumulatedOutputText = finalText;
          }
        }

        if (eventName === 'response.error') {
          console.error(`[refine:${requestId}] stream_error`, payload?.error || payload);
          sseEvent(res, 'error', { message: payload?.error?.message || 'OpenAI stream error.' });
          sseEvent(res, 'done', { ok: false });
          return res.end();
        }

        if (eventName === 'error' || eventName === 'response.failed') {
          const message =
            payload?.error?.message ||
            payload?.response?.error?.message ||
            payload?.message ||
            'OpenAI stream failed.';
          console.error(`[refine:${requestId}] stream_failed`, payload);
          sseEvent(res, 'error', { message });
          sseEvent(res, 'done', { ok: false });
          return res.end();
        }
      }
    }

    if (chunks.length === 0) {
      try {
        const finalPayload = JSON.parse(accumulatedOutputText);
        const parsedArray = sanitizeChunks(Array.isArray(finalPayload) ? finalPayload : finalPayload?.chunks);
        if (parsedArray.length > 0) {
          sseEvent(res, 'chunks', { chunks: parsedArray });
        }
      } catch {
        // No valid final JSON; will still send done.
      }
    }

    sseEvent(res, 'done', { ok: true });
    return res.end();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      console.warn(`[refine:${requestId}] aborted_by_client`);
      return res.end();
    }

    console.error(`[refine:${requestId}] exception`, {
      message: error?.message || 'Unknown error',
    });
    sseEvent(res, 'error', { message: error?.message || 'Failed to refine text incrementally.' });
    sseEvent(res, 'done', { ok: false });
    return res.end();
  }
});

app.get('/api/network-info', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || '';
  const port = host.includes(':') ? host.split(':')[1] : '';

  res.json({
    origin: host ? `${protocol}://${host}` : '',
    host,
    port,
    localIPs: getLocalIPv4Addresses(),
  });
});

if (!process.env.OPENAI_API_KEY) {
  console.warn('[startup] OPENAI_API_KEY is not set. /api/refine will return HTTP 500 until configured.');
}

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`RefineWrite AI server is listening on port ${port}`);
});
