const MAX_TEMPO = 1.12;
const MAX_STEP = 0.04;
const GAP = 0.05;

const planNaturalTiming = (segments) => {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const plan = sorted.map((segment, index) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.end <= segment.start
      || !Number.isFinite(segment.actualDuration) || segment.actualDuration <= 0) {
      throw new Error('Invalid narration timing: ' + segment.subtitle_id);
    }
    const next = sorted[index + 1];
    const boundary = next ? Math.min(segment.end + 0.3, next.start - GAP) : segment.end;
    const available = Math.max(0.001, boundary - segment.start);
    return { ...segment, availableDuration: available,
      requiredTempo: segment.actualDuration / available,
      tempo: Math.min(MAX_TEMPO, Math.max(1, segment.actualDuration / available)) };
  });
  const samePhrase = (a, b) => b.start - a.end <= 0.5
    && a.speaker === b.speaker && a.method === b.method;
  for (let i = 1; i < plan.length; i++) {
    if (samePhrase(plan[i - 1], plan[i]))
      plan[i].tempo = Math.max(plan[i].tempo, plan[i - 1].tempo - MAX_STEP);
  }
  for (let i = plan.length - 2; i >= 0; i--) {
    if (samePhrase(plan[i], plan[i + 1]))
      plan[i].tempo = Math.max(plan[i].tempo, plan[i + 1].tempo - MAX_STEP);
  }
  return plan.map(segment => ({
    ...segment,
    naturalEnd: segment.start + segment.actualDuration / segment.tempo,
    overflowMs: Math.max(0, Math.round((segment.actualDuration / segment.tempo - segment.availableDuration) * 1000)),
    timingPlanned: true
  }));
};

module.exports = { planNaturalTiming };
