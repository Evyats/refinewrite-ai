const express = require('express');
const { getLocalIPv4Addresses } = require('../network');

const createNetworkInfoRouter = () => {
  const router = express.Router();

  router.get('/network-info', (req, res) => {
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

  return router;
};

module.exports = {
  createNetworkInfoRouter,
};
