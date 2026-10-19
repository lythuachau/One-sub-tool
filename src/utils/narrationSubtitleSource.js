const getSubtitleId = (subtitle, index) => subtitle?.subtitle_id ?? subtitle?.id ?? index + 1;

const normalizeText = value => String(value || '').trim().replace(/\s+/g, ' ');

export const getNarrationSubtitlesForSource = ({
  subtitleSource,
  originalSubtitles,
  translatedSubtitles,
  subtitles
}) => {
  if (subtitleSource === 'translated') {
    return Array.isArray(translatedSubtitles) ? translatedSubtitles : [];
  }

  if (Array.isArray(originalSubtitles) && originalSubtitles.length > 0) return originalSubtitles;
  return Array.isArray(subtitles) ? subtitles : [];
};

export const groupedSubtitlesMatchSource = (groupedSubtitles, sourceSubtitles) => {
  if (!Array.isArray(groupedSubtitles) || groupedSubtitles.length === 0 ||
      !Array.isArray(sourceSubtitles) || sourceSubtitles.length === 0) return false;

  const sourceById = new Map();
  sourceSubtitles.forEach((subtitle, index) => {
    const id = String(getSubtitleId(subtitle, index));
    if (sourceById.has(id)) sourceById.set(id, null);
    else sourceById.set(id, { subtitle, index });
  });
  if ([...sourceById.values()].some(value => value === null)) return false;

  const hasSourceIds = groupedSubtitles.every(group => Array.isArray(group?.original_ids));
  if (!hasSourceIds) {
    return groupedSubtitles.length === sourceSubtitles.length && groupedSubtitles.every((group, index) =>
      normalizeText(group?.text) === normalizeText(sourceSubtitles[index]?.text)
    );
  }

  let expectedIndex = 0;
  for (const group of groupedSubtitles) {
    if (!group.original_ids.length) return false;

    const groupedSource = [];
    for (const id of group.original_ids) {
      const entry = sourceById.get(String(id));
      if (!entry || entry.index !== expectedIndex) return false;
      groupedSource.push(entry.subtitle);
      expectedIndex += 1;
    }

    const expectedText = normalizeText(groupedSource.map(item => item?.text).join(' '));
    if (normalizeText(group.text) !== expectedText) return false;
  }

  return expectedIndex === sourceSubtitles.length;
};

export const createSubtitleSourceFingerprint = (source, intensity, subtitles, model = '') => {
  const serialized = JSON.stringify({
    source,
    intensity,
    model,
    subtitles: (Array.isArray(subtitles) ? subtitles : []).map((subtitle, index) => [
      getSubtitleId(subtitle, index),
      subtitle?.start ?? subtitle?.startTime ?? subtitle?.start_time ?? null,
      subtitle?.end ?? subtitle?.endTime ?? subtitle?.end_time ?? null,
      String(subtitle?.text || '')
    ])
  });

  let firstHash = 0x811c9dc5;
  let secondHash = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    firstHash = Math.imul(firstHash ^ code, 0x01000193);
    secondHash = Math.imul(secondHash ^ code, 0x85ebca6b);
  }

  return `${source}:${serialized.length}:${(firstHash >>> 0).toString(16)}${(secondHash >>> 0).toString(16)}`;
};
