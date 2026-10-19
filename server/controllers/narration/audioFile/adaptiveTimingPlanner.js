const MAX_TEMPO = 1.12;
const MIN_GAP_SECONDS = 0.05;
const TIMING_TOLERANCE_MS = 20;

const createTimingPlan = segments => {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const plan = ordered.map((segment, index) => {
    const next = ordered[index + 1];
    const { start, end, actualDuration } = segment;

    if (![start, end, actualDuration].every(Number.isFinite)
      || start < 0 || end <= start || actualDuration <= 0) {
      const error = new Error(`Mốc thời gian hoặc audio của đoạn ${segment.subtitle_id} không hợp lệ.`);
      error.status = 422;
      error.code = 'INVALID_NARRATION_TIMING';
      error.segments = [{ id: segment.subtitle_id }];
      throw error;
    }

    if (next && (!Number.isFinite(next.start) || next.start <= start)) {
      const error = new Error(`Mốc bắt đầu của đoạn ${next.subtitle_id} không hợp lệ.`);
      error.status = 422;
      error.code = 'INVALID_NARRATION_TIMING';
      error.segments = [{ id: segment.subtitle_id }, { id: next.subtitle_id }];
      throw error;
    }

    const boundary = next ? next.start - MIN_GAP_SECONDS : Infinity;
    const availableDuration = boundary - start;
    const safeAvailableDuration = Math.max(0.001, availableDuration);
    const requiredTempo = actualDuration / safeAvailableDuration;
    const tempo = Math.min(MAX_TEMPO, Math.max(1, requiredTempo));
    const plannedDuration = actualDuration / tempo;
    const overflowMs = Number.isFinite(availableDuration)
      ? Math.max(0, Math.round((plannedDuration - safeAvailableDuration) * 1000))
      : 0;

    return {
      ...segment,
      availableDuration: safeAvailableDuration,
      requiredTempo,
      tempo,
      naturalEnd: start + plannedDuration,
      overflowMs,
      mismatchMs: overflowMs,
      timingPlanned: true
    };
  });

  return plan;
};

const planAdaptiveTiming = (segments) => {
  return createTimingPlan(segments);
};

const analyzeNarrationOverlaps = (segments) => {
  const overlapsById = new Map();
  const ordered = [...segments]
    .map(segment => ({
      ...segment,
      start: Number(segment.start),
      actualDuration: Number(segment.actualDuration)
    }))
    .sort((a, b) => a.start - b.start);

  ordered.forEach((segment, index) => {
    if (!Number.isFinite(segment.start) || segment.start < 0
      || !Number.isFinite(segment.actualDuration) || segment.actualDuration <= 0) return;
    const audioEnd = segment.start + segment.actualDuration;
    for (const later of ordered.slice(index + 1)) {
      if (!Number.isFinite(later.start)) continue;
      const overlapMs = Math.round((audioEnd - later.start) * 1000);
      if (overlapMs <= TIMING_TOLERANCE_MS) break;
      const id = String(segment.subtitle_id);
      const item = overlapsById.get(id) || { id: segment.subtitle_id, overlappedBy: [], overlapMs: 0 };
      item.overlappedBy.push(later.subtitle_id);
      item.overlapMs = Math.max(item.overlapMs, overlapMs);
      overlapsById.set(id, item);
    }
  });

  const overlaps = [...overlapsById.values()];
  return { overlappedIds: overlaps.map(item => item.id), overlaps };
};

module.exports = { planAdaptiveTiming, analyzeNarrationOverlaps };
