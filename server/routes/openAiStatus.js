const express = require('express');

const createOpenAiStatusRouter = ({ config }) => {
  const router = express.Router();
  const successCacheTtlMs = 60_000;
  const failureCacheTtlMs = 5_000;
  let cached = null;

  const setCache = (value, ttlMs) => {
    cached = {
      ...value,
      checkedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs,
    };
    return cached;
  };

  router.get('/openai-status', async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const log = (stage, details) => {
      if (details !== undefined) {
        console.info(`[api:openai-status:${requestId}] ${stage}`, details);
        return;
      }
      console.info(`[api:openai-status:${requestId}] ${stage}`);
    };

    log('request_received', {
      method: req.method,
      path: req.originalUrl,
      host: req.headers.host,
    });

    if (cached && Date.now() < cached.expiresAt) {
      log('cache_hit', { ready: cached.ready, checkedAt: cached.checkedAt });
      return res.json({
        ready: cached.ready,
        model: config.openAiModel,
        checkedAt: cached.checkedAt,
        message: cached.message,
      });
    }

    if (!config.llmRefinementEnabled) {
      log('blocked_disabled_by_config');
      const value = setCache({
        ready: false,
        message: 'LLM refinement is disabled by server configuration.',
      }, failureCacheTtlMs);
      return res.json({
        ready: value.ready,
        model: config.openAiModel,
        checkedAt: value.checkedAt,
        message: value.message,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log('blocked_missing_api_key');
      const value = setCache({
        ready: false,
        message: 'Missing OPENAI_API_KEY server environment variable.',
      }, failureCacheTtlMs);
      return res.json({
        ready: value.ready,
        model: config.openAiModel,
        checkedAt: value.checkedAt,
        message: value.message,
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.openAiModel)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      log('openai_response_received', {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.ok) {
        const value = setCache({ ready: true, message: 'OpenAI connection verified.' }, successCacheTtlMs);
        return res.json({
          ready: value.ready,
          model: config.openAiModel,
          checkedAt: value.checkedAt,
          message: value.message,
        });
      }

      let message = `OpenAI check failed with status ${response.status}.`;
      try {
        const errorPayload = await response.json();
        const errorMessage = errorPayload?.error?.message;
        if (typeof errorMessage === 'string' && errorMessage.trim()) {
          message = errorMessage;
        }
      } catch {
        // Keep fallback message.
      }

      const value = setCache({ ready: false, message }, failureCacheTtlMs);
      log('openai_response_failed', { message });
      return res.json({
        ready: value.ready,
        model: config.openAiModel,
        checkedAt: value.checkedAt,
        message: value.message,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      const message =
        error && error.name === 'AbortError'
          ? 'OpenAI check timed out.'
          : error?.message || 'Failed to verify OpenAI connection.';
      const value = setCache({ ready: false, message }, failureCacheTtlMs);
      log('openai_exception', { message });
      return res.json({
        ready: value.ready,
        model: config.openAiModel,
        checkedAt: value.checkedAt,
        message: value.message,
      });
    }
  });

  return router;
};

module.exports = {
  createOpenAiStatusRouter,
};
