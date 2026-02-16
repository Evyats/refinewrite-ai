const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const { config } = require('./server/config');
const { createApp } = require('./server/createApp');

if (!process.env.OPENAI_API_KEY) {
  console.warn('[startup] OPENAI_API_KEY is not set. /api/refine will return HTTP 500 until configured.');
}

const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`RefineWrite AI server is listening on port ${config.port}`);
});
