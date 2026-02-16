const os = require('os');

const normalizeIp = (ip) => {
  if (!ip) {
    return 'unknown';
  }
  return ip.replace(/^::ffff:/, '');
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded.split(',')[0].trim());
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
};

const getLocalIPv4Addresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.add(entry.address);
      }
    });
  });

  return Array.from(addresses);
};

module.exports = {
  getClientIp,
  getLocalIPv4Addresses,
};
