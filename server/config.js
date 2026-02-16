const DEFAULTS = {
  port: 8080,
  openAiModel: 'gpt-4o-mini',
  llmRefinementEnabled: true,
  maxInputChars: 20000,
  maxRequestsPerMinutePerIp: 20,
  maxRequestsPerDayPerIp: 300,
  minIntervalBetweenRequestsMs: 500,
  maxConcurrentRefinesPerIp: 2,
  maxConcurrentRefinesGlobal: 40,
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  port: parseNumber(process.env.PORT, DEFAULTS.port),
  openAiModel: process.env.OPENAI_MODEL || DEFAULTS.openAiModel,
  llmRefinementEnabled: process.env.LLM_REFINEMENT_ENABLED !== 'false',
  maxInputChars: parseNumber(process.env.MAX_INPUT_CHARS, DEFAULTS.maxInputChars),
  maxRequestsPerMinutePerIp: parseNumber(
    process.env.MAX_REQUESTS_PER_MINUTE_PER_IP,
    DEFAULTS.maxRequestsPerMinutePerIp
  ),
  maxRequestsPerDayPerIp: parseNumber(process.env.MAX_REQUESTS_PER_DAY_PER_IP, DEFAULTS.maxRequestsPerDayPerIp),
  minIntervalBetweenRequestsMs: parseNumber(
    process.env.MIN_INTERVAL_BETWEEN_REQUESTS_MS,
    DEFAULTS.minIntervalBetweenRequestsMs
  ),
  maxConcurrentRefinesPerIp: parseNumber(
    process.env.MAX_CONCURRENT_REFINES_PER_IP,
    DEFAULTS.maxConcurrentRefinesPerIp
  ),
  maxConcurrentRefinesGlobal: parseNumber(
    process.env.MAX_CONCURRENT_REFINES_GLOBAL,
    DEFAULTS.maxConcurrentRefinesGlobal
  ),
};

module.exports = {
  config,
  DEFAULTS,
};
