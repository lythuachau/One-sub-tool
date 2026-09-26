const startedAt = Number(process.env.STARTUP_EPOCH_MS) || Date.now();
const markedPhases = new Set();

const formatDetails = (details) => Object.entries(details || {})
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
  .join(' ');

const markStartupPhase = (phase, details = {}) => {
  const key = `${phase}:${details.service || ''}`;
  if (markedPhases.has(key)) return;
  markedPhases.add(key);
  const suffix = formatDetails(details);
  console.log(`[STARTUP] phase=${phase} elapsed_ms=${Date.now() - startedAt}${suffix ? ` ${suffix}` : ''}`);
};

module.exports = { markStartupPhase };
