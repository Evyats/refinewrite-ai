const { createApp } = require('../server/createApp');

module.exports = createApp({ apiOnly: true, apiBasePath: '/api' });
