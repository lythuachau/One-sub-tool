import { API_BASE_URL } from '../config';

const DEFAULT_ENGINE = 'gemini';

export const getSubtitleEngine = () => {
  const value = localStorage.getItem('subtitle_engine');
  return value === 'whisper' ? 'whisper' : DEFAULT_ENGINE;
};

const finiteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const splitText = (text, maxCharacters) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxCharacters) return [normalized];

  const parts = normalized.match(/[^。！？!?；;，,]+[。！？!?；;，,]?/g) || [normalized];
  const output = [];
  let current = '';
  parts.forEach((part) => {
    const next = `${current}${part}`.trim();
    if (current && next.length > maxCharacters) {
      output.push(current);
      current = part.trim();
    } else {
      current = next;
    }
  });
  if (current) output.push(current);
  return output.length > 1 ? output : [normalized];
};

const distributeTiming = (start, end, parts) => {
  const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
  const duration = Math.max(0.05, end - start);
  let cursor = start;
  return parts.map((part, index) => {
    const weight = Math.max(1, part.length);
    const partEnd = index === parts.length - 1
      ? end
      : cursor + duration * (weight / totalWeight);
    const result = { start: cursor, end: Math.max(cursor + 0.05, partEnd) };
    cursor = result.end;
    return result;
  });
};

const nearestSpeechBoundary = (value, regions, tolerance) => {
  let best = value;
  let distance = tolerance;
  regions.forEach((region) => {
    [region.start, region.end].forEach((boundary) => {
      const candidateDistance = Math.abs(boundary - value);
      if (candidateDistance < distance) {
        best = boundary;
        distance = candidateDistance;
      }
    });
  });
  return best;
};

export const applySpeechRegions = (subtitles, regions, duration) => {
  if (!Array.isArray(regions) || regions.length === 0) return subtitles;
  const maxDuration = finiteNumber(duration, Number.POSITIVE_INFINITY);
  let previousEnd = 0;
  return subtitles.map((subtitle) => {
    let start = nearestSpeechBoundary(subtitle.start, regions, 1.25);
    let end = nearestSpeechBoundary(subtitle.end, regions, 1.25);
    start = Math.max(previousEnd, Math.min(start, maxDuration));
    end = Math.max(start + 0.05, Math.min(end, maxDuration));
    previousEnd = end;
    return { ...subtitle, start, end };
  });
};

export const normalizeSubtitleSegments = (subtitles, duration, options = {}) => {
  if (!Array.isArray(subtitles)) return [];
  const maxDuration = finiteNumber(duration, Number.POSITIVE_INFINITY);
  const maxCharacters = options.maxCharacters || 72;
  const normalized = [];

  subtitles.forEach((subtitle, sourceIndex) => {
    const text = String(subtitle?.text || subtitle?.content || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const start = Math.max(0, Math.min(finiteNumber(subtitle.start, 0), maxDuration));
    const end = Math.max(start + 0.05, Math.min(finiteNumber(subtitle.end, start + 1), maxDuration));
    const parts = splitText(text, maxCharacters);
    const timings = distributeTiming(start, end, parts);
    parts.forEach((part, partIndex) => {
      normalized.push({
        ...subtitle,
        text: part,
        start: timings[partIndex].start,
        end: timings[partIndex].end,
        sourceId: subtitle.id ?? `source-${sourceIndex + 1}`,
        sourceIndex,
        splitIndex: partIndex
      });
    });
  });

  normalized.sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = 0;
  normalized.forEach((subtitle, index) => {
    subtitle.start = Math.max(previousEnd, subtitle.start);
    subtitle.end = Math.max(subtitle.start + 0.05, subtitle.end);
    if (Number.isFinite(maxDuration)) subtitle.end = Math.min(subtitle.end, maxDuration);
    subtitle.id = index + 1;
    previousEnd = subtitle.end;
  });
  return normalized;
};

export const normalizeGeminiSubtitles = async (mediaFile, subtitles, duration, onStatusUpdate) => {
  let normalized = normalizeSubtitleSegments(subtitles, duration);
  try {
    const body = new FormData();
    body.append('file', mediaFile, mediaFile.name || 'media');
    const response = await fetch(`${API_BASE_URL}/subtitle-engine/vad`, { method: 'POST', body });
    if (response.ok) {
      const result = await response.json();
      normalized = applySpeechRegions(normalized, result.regions, duration);
    }
  } catch (error) {
    console.warn('[SubtitleEngine] VAD normalization skipped:', error.message);
  }
  onStatusUpdate?.({
    message: `Gemini timestamp normalization complete (${normalized.length} segments)`,
    type: 'success'
  });
  return normalized;
};

export const transcribeWithWhisper = async (mediaFile, options = {}, onStatusUpdate) => {
  const body = new FormData();
  body.append('file', mediaFile, mediaFile.name || 'media');
  body.append('model', options.model || localStorage.getItem('whisper_model') || 'medium');
  body.append('device', options.device || localStorage.getItem('whisper_device') || 'auto');
  body.append('language', options.language || localStorage.getItem('source_language') || 'auto');
  onStatusUpdate?.({ message: 'Whisper đang nhận dạng giọng nói...', type: 'loading' });
  const response = await fetch(`${API_BASE_URL}/subtitle-engine/whisper`, { method: 'POST', body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Whisper request failed (${response.status})`);
  }
  const subtitles = normalizeSubtitleSegments(payload.segments, payload.duration);
  onStatusUpdate?.({
    message: `Whisper hoàn tất (${subtitles.length} segments, ${payload.detected || 'unknown'})`,
    type: 'success'
  });
  return subtitles;
};
