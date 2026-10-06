const planAdaptiveTiming = segments => {
  const ordered = [...segments].sort((a,b) => a.start - b.start);
  const plan = ordered.map((s,i) => {
    const end = Math.min(s.end, ordered[i+1]?.start ?? Infinity);
    const target = end - s.start;
    if (![s.start,end,s.actualDuration].every(Number.isFinite) || s.start < 0 || target <= 0 || s.actualDuration <= 0)
      throw Object.assign(new Error('Invalid adaptive timing: ' + s.subtitle_id), {status:422});
    const tempo = Math.min(1.12, Math.max(0.94, s.actualDuration / target));
    const duration = s.actualDuration / tempo;
    const delay = Math.min(0.15, Math.max(0,target-duration));
    const mismatch = Math.abs(target-delay-duration);
    return { ...s, start:s.start+delay, end, tempo, naturalEnd:s.start+delay+duration,
      mismatchMs:Math.round(mismatch*1000), timingPlanned:true };
  });
  const rejected = plan.filter(s => s.mismatchMs > 20 || s.needsTimingReview);
  if (rejected.length) throw Object.assign(new Error('Các cụm chưa khớp thời lượng: ' + rejected.map(s => s.subtitle_id + ' (lệch ' + s.mismatchMs + ' ms)').join(', ') + '. Cần tạo lại riêng cụm; audio chưa được ghép để tránh cắt lời.'), {
    status:422, code:'ADAPTIVE_TIMING_REVIEW_REQUIRED', segments:rejected.map(s=>({id:s.subtitle_id,mismatchMs:s.mismatchMs}))
  });
  return plan;
};
module.exports = { planAdaptiveTiming };
