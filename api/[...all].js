const serverless = require('serverless-http');
const { createApp } = require('../server/createApp');

const app = createApp({ apiOnly: true });

module.exports = serverless(app);
