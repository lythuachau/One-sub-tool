export const buildDubbingWindows = (subtitles, videoDuration) => {
  const ordered = subtitles.map((subtitle, index) => ({
    ...subtitle,
    id: subtitle.id ?? index + 1
  })).sort((a, b) => a.start - b.start);
  return ordered.map((s,i) => {
    const end = Math.min(s.end, ordered[i+1]?.start ?? Infinity,
      Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : Infinity);
    if (!Number.isFinite(s.start) || !Number.isFinite(end) || s.start < 0 || end <= s.start)
      throw new Error('Mốc thời gian cụm ' + s.id + ' không hợp lệ. Cần căn lại phụ đề theo lời gốc.');
    return { ...s, end };
  });
};

export const adaptiveTimingFields = result => result.timingVersion === 1 ? {
  timingVersion: 1, start: result.start, end: result.end, text: result.text
} : {};

export const assertAdaptiveReady = results => {
  if (!results.some(r => r.timingVersion === 1)) return;
  const rejected = results.filter(r => !r.success || (!r.filename && !r.audioData));
  if (rejected.length) throw new Error('Chưa ghép thuyết minh: cụm ' + rejected.map(r=>r.subtitle_id).join(', ') + ' chưa có audio hợp lệ. Tạo lại riêng các cụm này trước khi ghép.');
};
