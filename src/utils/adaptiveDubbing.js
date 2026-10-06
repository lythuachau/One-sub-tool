export const buildDubbingWindows = (subtitles, originals = [], videoDuration) => {
  const sources = new Map(originals.map((s, i) => [String(s.id ?? i + 1), s]));
  const ordered = subtitles.map((s, i) => {
    const source = sources.get(String(s.sourceId ?? s.originalId ?? s.id ?? i + 1))
      || sources.get(String(s.id ?? i + 1));
    const words = source?.words?.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end));
    const aligned = words?.length && Math.abs(source.start - s.start) < 0.05 && Math.abs(source.end - s.end) < 0.05;
    return { ...s, id: s.id ?? i + 1, sourceText: source?.text || '',
      start: aligned ? words[0].start : s.start,
      end: aligned ? words[words.length - 1].end : s.end,
      alignmentError: source?.alignmentError,
      timingBasis: aligned ? 'source-words' : 'subtitle-estimate' };
  }).sort((a,b) => a.start - b.start);
  return ordered.map((s,i) => {
    const end = Math.min(s.end, ordered[i+1]?.start ?? Infinity,
      Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : Infinity);
    if (!Number.isFinite(s.start) || !Number.isFinite(end) || s.start < 0 || end <= s.start)
      throw new Error('Mốc thời gian cụm ' + s.id + ' không hợp lệ. Cần căn lại phụ đề theo lời gốc.');
    return { ...s, end, targetDuration: end - s.start };
  });
};

export const adaptiveTimingFields = result => result.timingVersion === 1 ? {
  timingVersion: 1, start: result.start, end: result.end,
  text: result.text, needsTimingReview: result.needsTimingReview,
  timingBasis: result.timingBasis
} : {};

export const assertAdaptiveReady = results => {
  if (!results.some(r => r.timingVersion === 1)) return;
  const rejected = results.filter(r => !r.success || r.needsTimingReview || (!r.filename && !r.audioData));
  if (rejected.length) throw new Error('Chưa ghép thuyết minh: cụm ' + rejected.map(r=>r.subtitle_id).join(', ') + ' chưa đạt. Tạo lại riêng các cụm này để tránh mất lời.');
};
