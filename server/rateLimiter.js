const createRateLimiter = ({
  maxRequestsPerMinutePerIp,
  maxRequestsPerDayPerIp,
  minIntervalBetweenRequestsMs,
  maxConcurrentRefinesPerIp,
  maxConcurrentRefinesGlobal,
}) => {
  const perIpRequestWindow = new Map();
  const perIpDailyUsage = new Map();
  const perIpActiveRefines = new Map();
  const perIpLastRequestAt = new Map();
  let activeRefinesGlobal = 0;

  const todayKey = () => new Date().toISOString().slice(0, 10);

  const reserve = (ip) => {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const timestamps = (perIpRequestWindow.get(ip) || []).filter((time) => time >= minuteAgo);

    if (timestamps.length >= maxRequestsPerMinutePerIp) {
      perIpRequestWindow.set(ip, timestamps);
      return { ok: false, status: 429, message: 'Rate limit exceeded for this IP. Please wait and try again.' };
    }

    const lastRequestAt = perIpLastRequestAt.get(ip) || 0;
    if (now - lastRequestAt < minIntervalBetweenRequestsMs) {
      return { ok: false, status: 429, message: 'Requests are too frequent. Please slow down.' };
    }

    const dayKey = `${ip}:${todayKey()}`;
    const dailyCount = perIpDailyUsage.get(dayKey) || 0;
    if (dailyCount >= maxRequestsPerDayPerIp) {
      return { ok: false, status: 429, message: 'Daily refine limit reached for this IP.' };
    }

    const activeForIp = perIpActiveRefines.get(ip) || 0;
    if (activeForIp >= maxConcurrentRefinesPerIp) {
      return { ok: false, status: 429, message: 'Too many concurrent refine requests for this IP.' };
    }

    if (activeRefinesGlobal >= maxConcurrentRefinesGlobal) {
      return { ok: false, status: 429, message: 'Server is handling too many concurrent refine requests.' };
    }

    timestamps.push(now);
    perIpRequestWindow.set(ip, timestamps);
    perIpLastRequestAt.set(ip, now);
    perIpDailyUsage.set(dayKey, dailyCount + 1);
    perIpActiveRefines.set(ip, activeForIp + 1);
    activeRefinesGlobal += 1;

    return { ok: true };
  };

  const release = (ip) => {
    const activeForIp = perIpActiveRefines.get(ip) || 0;
    if (activeForIp <= 1) {
      perIpActiveRefines.delete(ip);
    } else {
      perIpActiveRefines.set(ip, activeForIp - 1);
    }
    activeRefinesGlobal = Math.max(0, activeRefinesGlobal - 1);
  };

  return {
    reserve,
    release,
  };
};

module.exports = {
  createRateLimiter,
};
