import { secondsToSrtTime } from './srtParser';

const toFiniteTime = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const getTimeFields = (subtitle) => ({
  start: subtitle.start !== undefined ? 'start' : 'startTime',
  end: subtitle.end !== undefined ? 'end' : 'endTime'
});

const getSubtitleInterval = (subtitle) => {
  const fields = getTimeFields(subtitle);
  const start = toFiniteTime(subtitle[fields.start], 0);
  const end = toFiniteTime(subtitle[fields.end], start);
  return { fields, start, end: Math.max(start, end) };
};

const createSplitId = (subtitle, suffix, existingIds) => {
  const baseId = subtitle.id ?? subtitle.segment_id ?? 'subtitle';
  const candidate = `${baseId}-split-${suffix}`;
  if (!existingIds.has(candidate)) return candidate;

  let counter = 2;
  while (existingIds.has(`${candidate}-${counter}`)) counter += 1;
  return `${candidate}-${counter}`;
};

export const splitSubtitleAtCursor = (subtitles, index, cursorPosition, textOverride) => {
  const subtitle = subtitles[index];
  if (!subtitle) return subtitles;

  const text = String(textOverride ?? subtitle.text ?? '');
  const before = text.slice(0, cursorPosition).trim();
  const after = text.slice(cursorPosition).trim();
  if (!before || !after) return subtitles;

  const { fields, start, end } = getSubtitleInterval(subtitle);
  if (end <= start) return subtitles;
  const totalLength = before.length + after.length;
  const rawSplitTime = start + ((end - start) * before.length) / totalLength;
  const minimumPart = Math.min(0.05, (end - start) / 2);
  const splitTime = Math.min(end - minimumPart, Math.max(start + minimumPart, rawSplitTime));
  const existingIds = new Set(subtitles.map(item => item.id ?? item.segment_id).filter(Boolean));
  const secondId = createSplitId(subtitle, 'b', existingIds);
  const firstSubtitle = {
    ...subtitle,
    text: before,
    [fields.start]: start,
    [fields.end]: splitTime
  };
  const secondSubtitle = {
    ...subtitle,
    id: subtitle.id !== undefined ? secondId : subtitle.id,
    segment_id: subtitle.segment_id !== undefined ? secondId : subtitle.segment_id,
    text: after,
    [fields.start]: splitTime,
    [fields.end]: end,
    split_from: subtitle.id ?? subtitle.segment_id ?? index
  };

  if (subtitle.startTime !== undefined) {
    firstSubtitle.startTime = typeof subtitle.startTime === 'string' ? secondsToSrtTime(start) : start;
    secondSubtitle.startTime = typeof subtitle.startTime === 'string' ? secondsToSrtTime(splitTime) : splitTime;
  }
  if (subtitle.endTime !== undefined) {
    firstSubtitle.endTime = typeof subtitle.endTime === 'string' ? secondsToSrtTime(splitTime) : splitTime;
    secondSubtitle.endTime = typeof subtitle.endTime === 'string' ? secondsToSrtTime(end) : end;
  }

  return [
    ...subtitles.slice(0, index),
    firstSubtitle,
    secondSubtitle,
    ...subtitles.slice(index + 1)
  ];
};
