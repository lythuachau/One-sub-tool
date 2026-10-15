export const DEFAULT_WHISPER_MODEL = 'medium';

export const WHISPER_MODEL_OPTIONS = [
  {
    id: 'medium',
    labelKey: 'settings.whisperModelMedium',
    fallbackLabel: 'Medium — 3 GB+ free VRAM (balanced)'
  },
  {
    id: 'large-v3-turbo',
    labelKey: 'settings.whisperModelLargeV3Turbo',
    fallbackLabel: 'Large v3 Turbo — 4 GB+ free VRAM (strong and fast)'
  },
  {
    id: 'large-v3',
    labelKey: 'settings.whisperModelLargeV3',
    fallbackLabel: 'Large v3 — 6 GB+ free VRAM (quality priority)'
  }
];

export const resolveWhisperModel = (value) => (
  WHISPER_MODEL_OPTIONS.some((model) => model.id === value)
    ? value
    : DEFAULT_WHISPER_MODEL
);
