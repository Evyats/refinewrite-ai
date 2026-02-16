const express = require('express');
const path = require('path');
const { config } = require('./config');
const { createRateLimiter } = require('./rateLimiter');
const { createRefineRouter } = require('./routes/refine');
const { createNetworkInfoRouter } = require('./routes/networkInfo');
const { createOpenAiStatusRouter } = require('./routes/openAiStatus');

const createApp = () => {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  const limiter = createRateLimiter({
    maxRequestsPerMinutePerIp: config.maxRequestsPerMinutePerIp,
    maxRequestsPerDayPerIp: config.maxRequestsPerDayPerIp,
    minIntervalBetweenRequestsMs: config.minIntervalBetweenRequestsMs,
    maxConcurrentRefinesPerIp: config.maxConcurrentRefinesPerIp,
    maxConcurrentRefinesGlobal: config.maxConcurrentRefinesGlobal,
  });

  app.use('/api', createRefineRouter({ config, rateLimiter: limiter }));
  app.use('/api', createNetworkInfoRouter());
  app.use('/api', createOpenAiStatusRouter({ config }));
  app.use('/api', (req, res) => {
    console.warn('[api] route_not_found', {
      method: req.method,
      path: req.originalUrl,
      host: req.headers.host,
      userAgent: req.headers['user-agent'],
    });
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      hint: 'Check deployment routing and ensure backend functions are deployed for /api/* endpoints.',
    });
  });

  app.use(express.static(path.join(__dirname, '..')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  return app;
};

module.exports = {
  createApp,
};
