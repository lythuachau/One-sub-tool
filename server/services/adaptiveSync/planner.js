const crypto = require('crypto');

const DEFAULTS = Object.freeze({ lead: 0.25, softLag: 0.6, hardLag: 1.5, softTempo: 1.25,
  hardTempo: 1.45, tempoCap: 1.6, minVideoSpeed: 0.8, gap: 0.05, originalVolume: 0.15, voiceVolume: 1 });

const normalizeOptions = input => {
  if (Object.keys(input).some(key => !(key in DEFAULTS))) throw new Error('Unknown adaptive sync option');
  const options = { ...DEFAULTS, ...input };
  for (const [key, limit] of Object.entries(DEFAULTS)) {
    const maximum = ['originalVolume', 'voiceVolume', 'minVideoSpeed'].includes(key) ? 1 : limit;
    if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > maximum) {
      throw new Error(`Invalid adaptive sync option: ${key}`);
    }
  }
  if (options.minVideoSpeed < 0.8 || options.softTempo < 1 || options.hardTempo < options.softTempo
    || options.tempoCap < options.hardTempo || options.hardLag < options.softLag || options.gap < 0.05) {
    throw new Error('Invalid adaptive sync limits');
  }
  return options;
};

const mergeWarps = intervals => {
  const boundaries = [...new Set(intervals.flatMap(item => [item.start, item.end]))].sort((a, b) => a - b);
  const result = [];
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1], end = boundaries[i];
    const factor = Math.max(1, ...intervals.filter(item => item.start < end && item.end > start).map(item => item.factor));
    if (factor <= 1) continue;
    const last = result[result.length - 1];
    if (last && last.end === start && last.factor === factor) last.end = end;
    else result.push({ start, end, factor });
  }
  return result;
};

const mapTime = (time, warps) => time + warps.reduce((extra, item) =>
  extra + (item.factor - 1) * Math.max(0, Math.min(time - item.start, item.end - item.start)), 0);

const mapSubtitles = (subtitles, warps, placements = []) => {
  const placementById = new Map(placements.map(item => [String(item.id), item]));
  return (subtitles || []).map(item => {
    const start = Number(item.start ?? item.startTime), end = Number(item.end ?? item.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error('Invalid subtitle timestamp');
    }
    const mappedStart = mapTime(start, warps), mappedEnd = mapTime(end, warps);
    const id = item.id ?? item.subtitle_id;
    const placement = id == null ? null : placementById.get(String(id));
    const outputStart = placement ? Math.min(mappedStart, placement.outStart) : mappedStart;
    const outputEnd = placement ? Math.max(mappedEnd, placement.outEnd) : mappedEnd;
    return { ...item, start: outputStart, end: outputEnd, startTime: outputStart, endTime: outputEnd };
  });
};

const createSyncPlan = ({ segments, duration, options: inputOptions = {}, subtitles = {}, subtitleSource = 'original' }) => {
  const options = normalizeOptions(inputOptions);
  if (!Number.isFinite(duration) || duration <= 0 || !segments?.length) throw new Error('Video and narration are required');
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const ids = new Set();
  for (const item of ordered) {
    if (ids.has(String(item.id)) || ![item.start, item.end, item.duration].every(Number.isFinite)
      || item.start < 0 || item.end <= item.start || item.end > duration + 0.05 || item.duration <= 0) {
      throw new Error(`Invalid narration timing or duplicate ID: ${item.id}`);
    }
    ids.add(String(item.id));
  }
  let warps = [];
  const windowFor = (item, next, previousEnd, lag) => {
    const start = Math.max(0, mapTime(item.start, warps) - options.lead, previousEnd + options.gap);
    const end = Math.min(mapTime(item.end, warps) + lag,
      next ? mapTime(next.start, warps) - options.gap : Infinity);
    return { start, available: Math.max(0, end - start) };
  };
  let previousEnd = -options.gap;
  ordered.forEach((item, index) => {
    let window = windowFor(item, ordered[index + 1], previousEnd, options.softLag);
    if (item.duration > window.available * options.softTempo + 0.000001) {
      warps = mergeWarps([...warps, { start: item.start, end: item.end, factor: 1 / options.minVideoSpeed }]);
      window = windowFor(item, ordered[index + 1], previousEnd, options.softLag);
    }
    previousEnd = window.start + item.duration / Math.min(options.tempoCap,
      Math.max(1, item.duration / Math.max(window.available, 0.001)));
  });
  previousEnd = -options.gap;
  const placements = ordered.map((item, index) => {
    let window = windowFor(item, ordered[index + 1], previousEnd, options.softLag);
    const localWarp = warps.some(warp => warp.start < item.end && warp.end > item.start);
    let tempo = Math.max(1, item.duration / Math.max(window.available, 0.001));
    let tier = localWarp ? 3 : tempo <= 1 ? 1 : 2;
    if (tempo > options.softTempo + 0.000001) {
      window = windowFor(item, ordered[index + 1], previousEnd, options.hardLag);
      tempo = Math.max(1, item.duration / Math.max(window.available, 0.001));
      tier = tempo <= options.hardTempo + 0.000001 ? 4 : 5;
    }
    tempo = Math.min(options.tempoCap, tempo);
    const outEnd = window.start + item.duration / tempo;
    const overflowMs = Math.max(0, Math.round((outEnd - window.start - window.available) * 1000));
    previousEnd = outEnd;
    return { ...item, outStart: window.start, outEnd, tempo, tier, videoSpeed: localWarp ? options.minVideoSpeed : 1,
      overflowMs, status: overflowMs > 0 ? 'extended' : 'ready', trimmed: false };
  });
  const unresolved = [];
  const retimedVideoDuration = mapTime(duration, warps);
  const outputDuration = Math.max(retimedVideoDuration, ...placements.map(item => item.outEnd));
  const mappedSubtitles = Object.fromEntries(Object.entries(subtitles)
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => [key, mapSubtitles(items, warps, key === subtitleSource ? placements : [])]));
  return { schemaVersion: 2, options, sourceDuration: duration, retimedVideoDuration, outputDuration, warps,
    placements, unresolved, ready: true,
    mappedSubtitles };
};

const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

module.exports = { DEFAULTS, normalizeOptions, mergeWarps, mapTime, mapSubtitles, createSyncPlan, fingerprint };
