const express = require('express');
const { ALLOWED_TYPES, getSystemInstruction } = require('../refinementInstructions');
const { extractCompleteObjects, extractTextFromResponsePayload, sanitizeChunks } = require('../parsers');
const { sseEvent, setupSseHeaders } = require('../sse');
const { getClientIp } = require('../network');

const createOpenAiRequestBody = ({ model, systemInstruction, text }) => {
  const prompt = `Input: "${text}"\nResponse Format: OBJECT: { "chunks": ARRAY of { "t": "new text", "o": "original or null" } }. Every character must be accounted for.`;

  return {
    model,
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
  };
};

const createRefineRouter = ({ config, rateLimiter }) => {
  const router = express.Router();

  router.post('/refine', async (req, res) => {
    if (!config.llmRefinementEnabled) {
      return res.status(503).json({ error: 'LLM refinement is currently disabled by server configuration.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY server environment variable.' });
    }

    const { text, type, customInstruction } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '"text" must be a non-empty string.' });
    }

    if (text.length > config.maxInputChars) {
      return res.status(413).json({ error: `"text" exceeds MAX_INPUT_CHARS (${config.maxInputChars}).` });
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

    const clientIp = getClientIp(req);
    const slot = rateLimiter.reserve(clientIp);
    if (!slot.ok) {
      return res.status(slot.status).json({ error: slot.message });
    }

    let slotReleased = false;
    const releaseSlotIfNeeded = () => {
      if (slotReleased) {
        return;
      }
      slotReleased = true;
      rateLimiter.release(clientIp);
    };

    res.on('close', releaseSlotIfNeeded);
    setupSseHeaders(res);

    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    res.on('close', () => {
      releaseSlotIfNeeded();
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(
          createOpenAiRequestBody({
            model: config.openAiModel,
            systemInstruction: getSystemInstruction(type, customInstruction),
            text,
          })
        ),
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
              for (let index = processedObjectCount; index < objectStrings.length; index += 1) {
                try {
                  const parsed = JSON.parse(objectStrings[index]);
                  if (typeof parsed.t === 'string' && (typeof parsed.o === 'string' || parsed.o === null)) {
                    chunks.push({ t: parsed.t, o: parsed.o });
                    processedObjectCount += 1;
                  }
                } catch {
                  // Wait for more stable JSON.
                }
              }
              sseEvent(res, 'chunks', { chunks });
            }
          }

          if ((eventName === 'response.completed' || eventName === 'response.output_text.done') && !accumulatedOutputText) {
            const finalText =
              eventName === 'response.output_text.done' ? payload?.text : extractTextFromResponsePayload(payload);
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
          // No valid final JSON. Keep done response.
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

  return router;
};

module.exports = {
  createRefineRouter,
  createOpenAiRequestBody,
};
