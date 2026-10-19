import {
  createSubtitleSourceFingerprint,
  getNarrationSubtitlesForSource,
  groupedSubtitlesMatchSource
} from './narrationSubtitleSource';

const original = [
  { id: 1, start: 0, end: 1, text: 'Hello' },
  { id: 2, start: 1, end: 2, text: 'world.' }
];
const translated = [
  { id: 1, start: 0, end: 1, text: 'Xin chào' },
  { id: 2, start: 1, end: 2, text: 'thế giới.' }
];
const originalGroup = [{ id: 1, start: 0, end: 2, text: 'Hello world.', original_ids: [1, 2] }];
const translatedGroup = [{ id: 1, start: 0, end: 2, text: 'Xin chào thế giới.', original_ids: [1, 2] }];

describe('narration subtitle source helpers', () => {
  test('uses the selected translated text instead of falling back to original subtitles', () => {
    expect(getNarrationSubtitlesForSource({
      subtitleSource: 'translated',
      originalSubtitles: original,
      translatedSubtitles: translated
    })).toBe(translated);
    expect(getNarrationSubtitlesForSource({
      subtitleSource: 'translated',
      originalSubtitles: original,
      translatedSubtitles: []
    })).toEqual([]);
  });

  test('accepts a grouping only when its text matches the selected source', () => {
    expect(groupedSubtitlesMatchSource(originalGroup, original)).toBe(true);
    expect(groupedSubtitlesMatchSource(originalGroup, translated)).toBe(false);
    expect(groupedSubtitlesMatchSource(translatedGroup, translated)).toBe(true);
  });

  test('rejects incomplete, out-of-order, and duplicate source mappings', () => {
    expect(groupedSubtitlesMatchSource([
      { ...originalGroup[0], original_ids: [1] }
    ], original)).toBe(false);
    expect(groupedSubtitlesMatchSource([
      { ...originalGroup[0], original_ids: [2, 1] }
    ], original)).toBe(false);
    expect(groupedSubtitlesMatchSource(originalGroup, [original[0], original[0]])).toBe(false);
  });

  test('fingerprint includes every subtitle, source, and grouping intensity', () => {
    const baseline = createSubtitleSourceFingerprint('original', 'moderate', original);
    expect(createSubtitleSourceFingerprint('translated', 'moderate', original)).not.toBe(baseline);
    expect(createSubtitleSourceFingerprint('original', 'aggressive', original)).not.toBe(baseline);
    expect(createSubtitleSourceFingerprint('original', 'moderate', [
      original[0], { ...original[1], text: 'changed in the middle' }
    ])).not.toBe(baseline);
  });
});
