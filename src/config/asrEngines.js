export const CATALOG_ASR_ENGINES = [
  {
    id: 'faster-whisper-turbo',
    labelKey: 'settings.asrFasterWhisperTurbo',
    fallbackLabel: 'Faster-Whisper Large-v3 Turbo (local catalog)',
    serviceId: 'faster-whisper-turbo',
  },
  {
    id: 'faster-whisper-large-v3',
    labelKey: 'settings.asrFasterWhisperLargeV3',
    fallbackLabel: 'Faster-Whisper Large-v3 (local catalog)',
    serviceId: 'faster-whisper-large-v3',
  },
  {
    id: 'qwen3-asr-1.7b',
    labelKey: 'settings.asrQwen3Large',
    fallbackLabel: 'Qwen3-ASR 1.7B',
    serviceId: 'qwen3-asr-1.7b',
  },
  {
    id: 'qwen3-asr-0.6b',
    labelKey: 'settings.asrQwen3Small',
    fallbackLabel: 'Qwen3-ASR 0.6B',
    serviceId: 'qwen3-asr-0.6b',
  },
];

export const MANAGED_ASR_ENGINES = [
  ...CATALOG_ASR_ENGINES,
  {
    id: 'nvidia-parakeet',
    labelKey: 'settings.asrParakeet',
    fallbackLabel: 'NVIDIA Parakeet (local)',
    serviceId: 'parakeet',
  },
];

export const LOCAL_SUBTITLE_ENGINES = MANAGED_ASR_ENGINES.map((engine) => engine.id);

export const normalizeSubtitleEngine = (value) => {
  const normalizedValue = value === 'whisper' ? 'faster-whisper-turbo' : value;
  return normalizedValue === 'gemini' || LOCAL_SUBTITLE_ENGINES.includes(normalizedValue)
    ? normalizedValue
    : 'gemini';
};

export const isLocalSubtitleEngine = (value) => LOCAL_SUBTITLE_ENGINES.includes(value);

export const getManagedAsrEngine = (value) => (
  MANAGED_ASR_ENGINES.find((engine) => engine.id === value) || null
);
