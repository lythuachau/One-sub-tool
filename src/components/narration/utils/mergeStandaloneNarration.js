const encodeWave = (audioBuffer) => {
  const channels = audioBuffer.numberOfChannels;
  const frames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

export const buildMergedNarrationWav = async (results, getAudioUrl) => {
  const playable = (results || [])
    .filter((result) => result.success && result.filename)
    .sort((left, right) => Number(left.subtitle_id) - Number(right.subtitle_id));
  if (!playable.length) throw new Error('Chưa có đoạn audio thành công để ghép.');

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) {
    throw new Error('Trình duyệt hiện tại không hỗ trợ ghép audio.');
  }

  const decoder = new AudioContextClass();
  try {
    const decoded = [];
    for (const result of playable) {
      const response = await fetch(getAudioUrl(result.filename));
      if (!response.ok) throw new Error(`Không tải được đoạn ${result.subtitle_id} (HTTP ${response.status}).`);
      decoded.push(await decoder.decodeAudioData(await response.arrayBuffer()));
    }

    const sampleRate = 44100;
    const channels = 2;
    const gapSeconds = 0.15;
    const totalSeconds = decoded.reduce((total, item) => total + item.duration, 0)
      + gapSeconds * Math.max(0, decoded.length - 1);
    const frameCount = Math.max(1, Math.ceil(totalSeconds * sampleRate));
    const offline = new OfflineAudioContextClass(channels, frameCount, sampleRate);
    let startAt = 0;

    decoded.forEach((audioBuffer) => {
      const source = offline.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offline.destination);
      source.start(startAt);
      startAt += audioBuffer.duration + gapSeconds;
    });

    return encodeWave(await offline.startRendering());
  } finally {
    if (decoder.state !== 'closed') await decoder.close();
  }
};
