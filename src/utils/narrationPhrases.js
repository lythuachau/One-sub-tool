export const buildNarrationPhrases = (subtitles, originals = []) => {
  const sourceMap = new Map(originals.map(s => [String(s.id), s]));
  const entries = subtitles.map((s, index) => ({ ...s, id: s.id ?? index + 1 }));
  const resolveSource = s => {
    const explicit = s.originalId ?? s.sourceId ?? s.split_from;
    if (explicit != null && sourceMap.has(String(explicit))) return String(explicit);
    const match = String(s.id).match(/^(.*)_\d+$/);
    return match && sourceMap.has(match[1]) ? match[1] : null;
  };
  const groups = [];
  for (const entry of entries) {
    const sourceId = resolveSource(entry);
    const previous = groups[groups.length - 1];
    if (sourceId && previous?.sourceId === sourceId
      && previous.items[0].speaker === entry.speaker) previous.items.push(entry);
    else groups.push({ sourceId, items: [entry] });
  }
  return groups.map(({ sourceId, items }) => {
    if (items.length < 2) return items[0];
    const original = sourceMap.get(sourceId);
    const start = Number(original?.start);
    const end = Number(original?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('Câu gốc ' + sourceId + ' có mốc thời gian không hợp lệ.');
    }
    return {
      ...items[0],
      id: 'tts-phrase-' + String(items[0].id),
      start, end,
      text: items.map(s => s.text || s.translated_text || '').join(' ').trim(),
      original_ids: items.map(s => s.id),
      sourceId,
      isGrouped: true
    };
  });
};
