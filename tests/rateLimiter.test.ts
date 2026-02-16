import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../server/rateLimiter';

describe('createRateLimiter', () => {
  it('blocks requests above minute limit', () => {
    const limiter = createRateLimiter({
      maxRequestsPerMinutePerIp: 1,
      maxRequestsPerDayPerIp: 10,
      minIntervalBetweenRequestsMs: 0,
      maxConcurrentRefinesPerIp: 10,
      maxConcurrentRefinesGlobal: 10,
    });

    expect(limiter.reserve('1.2.3.4').ok).toBe(true);
    const blocked = limiter.reserve('1.2.3.4');
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
  });

  it('releases concurrent slots', () => {
    const limiter = createRateLimiter({
      maxRequestsPerMinutePerIp: 10,
      maxRequestsPerDayPerIp: 10,
      minIntervalBetweenRequestsMs: 0,
      maxConcurrentRefinesPerIp: 1,
      maxConcurrentRefinesGlobal: 1,
    });

    expect(limiter.reserve('7.7.7.7').ok).toBe(true);
    expect(limiter.reserve('7.7.7.7').ok).toBe(false);
    limiter.release('7.7.7.7');
    expect(limiter.reserve('7.7.7.7').ok).toBe(true);
  });
});
