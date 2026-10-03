const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

export const getNarrationOptimizationConfig = () => {
  if (localStorage.getItem('narration_method') !== 'vieneu') return null;

  const advancedSettings = readJson('narration_advanced_settings') || {};
  const referenceCache = readJson('reference_audio_cache');
  const referenceAudio = referenceCache?.referenceAudio || referenceCache || {};
  const voiceMode = localStorage.getItem('vieneu_voice_mode') || 'preset';
  const voice = localStorage.getItem('vieneu_voice') || '';
  const referenceAudioPath = referenceAudio.filepath || referenceAudio.path || referenceAudio.filename || null;
  if (voiceMode === 'reference' && !referenceAudioPath) return null;
  const settings = {
    ...advancedSettings,
    speechRate: Number(advancedSettings.speechRate || 1.3)
  };

  if (voiceMode === 'preset' && voice) {
    settings.voice = voice;
  }

  return {
    enabled: true,
    engine: 'vieneu',
    gapMs: 50,
    maxCandidates: 2,
    tts: {
      reference_audio: voiceMode === 'reference'
        ? referenceAudioPath
        : null,
      reference_text: voiceMode === 'reference' ? referenceAudio.text || '' : '',
      settings
    }
  };
};
