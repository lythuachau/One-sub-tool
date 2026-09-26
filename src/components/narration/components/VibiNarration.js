import { useEffect, useRef, useState } from 'react';
import { getAudioUrl } from '../../../services/narrationService';
import { getVibiCatalog, synthesizeVibi } from '../../../services/vibiTtsService';
import GenerateButton from './GenerateButton';
import NarrationResults from './NarrationResults';
import MaterialSwitch from '../../common/MaterialSwitch';
import '../../../styles/common/material-switch.css';

const DEFAULT_SETTINGS = { stability: 0.5, similarityBoost: 0.75, style: 0, useSpeakerBoost: true };

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

const readVoiceSettings = () => {
  const supportedSettings = { ...readJson('vibi_voice_settings', {}) };
  delete supportedSettings.speed;
  return { ...DEFAULT_SETTINGS, ...supportedSettings };
};

export default function VibiNarration({ children, getSubtitles, subtitleSource, isGenerating, setIsGenerating,
  generationResults, setGenerationResults, downloadAllAudio, downloadAlignedAudio, currentAudio, isPlaying,
  playAudio, useGroupedSubtitles, audioRef, handleAudioEnded }) {
  const [modelId, setModelId] = useState('');
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('vibi_voice_id') || '');
  const [languageCode, setLanguageCode] = useState(() => localStorage.getItem('vibi_language_code') || 'vi');
  const [voiceSettings, setVoiceSettings] = useState(readVoiceSettings);
  const [exportTranscript, setExportTranscript] = useState(() => localStorage.getItem('vibi_export_transcript') === 'true');
  const [models, setModels] = useState([]);
  const [voices, setVoices] = useState([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retrying, setRetrying] = useState(null);
  const controller = useRef(null);
  const previewAudio = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const audio = previewAudio.current;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      audio?.pause();
    };
  }, []);

  useEffect(() => { if (modelId) localStorage.setItem('vibi_model_id', modelId); }, [modelId]);
  useEffect(() => { localStorage.setItem('vibi_voice_id', voiceId); }, [voiceId]);
  useEffect(() => { localStorage.setItem('vibi_language_code', languageCode); }, [languageCode]);
  useEffect(() => { localStorage.setItem('vibi_voice_settings', JSON.stringify(voiceSettings)); }, [voiceSettings]);
  useEffect(() => { localStorage.setItem('vibi_export_transcript', String(exportTranscript)); }, [exportTranscript]);

  const run = async (operation, generating = false) => {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    if (generating) setIsGenerating(true);
    try { await operation(active.signal); }
    catch (error) {
      if (mounted.current) setMessage(error.name === 'AbortError' ? 'Đã dừng tác vụ Vibi.' : error.message);
    } finally {
      controller.current = null;
      if (generating) setIsGenerating(false);
      if (mounted.current) { setBusy(false); setRetrying(null); }
    }
  };

  const apiKey = () => localStorage.getItem('vibi_api_key')?.trim() || '';

  const loadCatalog = () => run(async signal => {
    setCatalogLoaded(false);
    setModels([]);
    setVoices([]);
    setModelId('');
    setVoiceId('');
    const catalog = await getVibiCatalog(apiKey(), signal);
    const availableModels = (catalog.models || []).filter(model => {
      const provider = String(model.provider || '').toLowerCase();
      const languages = Array.isArray(model.languages) ? model.languages.map(language => String(language).toLowerCase()) : [];
      return (!provider || provider === 'elevenlabs') && model.canDoTextToSpeech !== false && (!languages.length || languages.some(language => language.startsWith('vi')));
    });
    const availableVoices = (catalog.voices || []).filter(voice => {
      const languages = Array.isArray(voice.languages) ? voice.languages.map(language => String(language).toLowerCase()) : [];
      return !languages.length || languages.some(language => language.startsWith('vi'));
    });
    setModels(availableModels);
    setVoices(availableVoices);
    setCatalogLoaded(true);
    const savedModel = localStorage.getItem('vibi_model_id');
    if (!availableModels.some(model => model.id === modelId) && availableModels.length) {
      setModelId(availableModels.some(model => model.id === savedModel) ? savedModel : availableModels[0].id);
    }
    if (!availableVoices.some(voice => voice.id === voiceId) && availableVoices.length) setVoiceId(availableVoices[0].id);
    setMessage(`Đã xác thực ${availableVoices.length} giọng Việt và ${availableModels.length} model Vibi có thể dùng.`);
  });

  const synthesize = (text, signal) => synthesizeVibi(apiKey(), {
    text,
    voiceId,
    modelId,
    languageCode,
    voiceSettings,
    exportTranscript
  }, signal);

  const preview = () => run(async signal => {
    const result = await synthesize(languageCode.startsWith('vi') ? 'Xin chào, đây là bản nghe thử giọng Vibi.' : 'Hello, this is a Vibi voice preview.', signal);
    const player = previewAudio.current;
    if (!player) throw new Error('Không khởi tạo được trình phát nghe thử.');
    player.src = getAudioUrl(result.filename);
    player.load();
    try { await player.play(); setMessage('Đang phát bản nghe thử giọng Vibi.'); }
    catch { setMessage('Audio đã tạo xong nhưng trình duyệt chặn tự phát. Hãy bấm Nghe thử giọng lại.'); }
  });

  const generate = (onlyIds) => run(async signal => {
    if (!catalogLoaded || !modelId || !voiceId) throw new Error('Hãy bấm Tải model & giọng để xác thực model và giọng Vibi trước khi tạo thuyết minh.');
    const selected = (getSubtitles() || []).map((subtitle, index) => ({ ...subtitle, id: subtitle.id ?? index + 1 }));
    if (!selected.length) throw new Error('Chưa có phụ đề để tạo thuyết minh.');
    const results = onlyIds ? [...generationResults] : [];
    const pending = onlyIds ? selected.filter(subtitle => onlyIds.some(id => String(id) === String(subtitle.id))) : selected;
    if (!onlyIds) setGenerationResults([]);
    for (let index = 0; index < pending.length; index += 1) {
      signal.throwIfAborted();
      const subtitle = pending[index];
      setMessage(`Vibi: ${index + 1}/${pending.length}`);
      let result;
      try {
        const audio = await synthesize(subtitle.text || subtitle.translated_text || '', signal);
        result = { ...audio, subtitle_id: subtitle.id, text: subtitle.text || subtitle.translated_text,
          start: subtitle.start, end: subtitle.end, method: 'vibi', voice: voiceId, model: modelId };
      } catch (error) {
        if (signal.aborted) throw error;
        result = { success: false, subtitle_id: subtitle.id, text: subtitle.text || subtitle.translated_text, error: error.message };
      }
      const oldIndex = results.findIndex(item => String(item.subtitle_id) === String(subtitle.id));
      if (oldIndex >= 0) results[oldIndex] = result; else results.push(result);
      setGenerationResults([...results]);
      if (useGroupedSubtitles) { window.groupedNarrations = [...results]; window.useGroupedSubtitles = true; }
    }
    const failed = results.filter(result => !result.success).length;
    setMessage(failed ? `${failed} câu lỗi. Có thể thử lại từng câu.` : 'Đã tạo xong thuyết minh Vibi.');
  }, true);

  const updateSetting = (key, value) => setVoiceSettings(current => ({ ...current, [key]: value }));
  const selectedVoice = voices.find(voice => voice.id === voiceId);
  return <div className="vibi-content">
    <div className="narration-row"><div className="row-label">Vibi model:</div><div className="row-content">
      <select className="pill-button secondary" value={modelId} disabled={busy || isGenerating || !catalogLoaded} onChange={event => setModelId(event.target.value)}>
        {!catalogLoaded && <option value="">Bấm Tải model & giọng để kiểm tra</option>}
        {models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
      </select>
      <button className="pill-button secondary" disabled={busy || isGenerating} onClick={loadCatalog}>Tải model & giọng</button>
    </div></div>
    <div className="narration-row"><div className="row-label">Giọng Vibi:</div><div className="row-content">
      <select className="pill-button secondary" value={voiceId} disabled={busy || isGenerating || !catalogLoaded} onChange={event => setVoiceId(event.target.value)}>
        {!selectedVoice && <option value="">Chọn giọng Việt</option>}
        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}{voice.language ? ` (${voice.language})` : ''}</option>)}
      </select>
      <select className="pill-button secondary" value={languageCode} disabled={busy || isGenerating} onChange={event => setLanguageCode(event.target.value)}>
        <option value="vi">Tiếng Việt (vi)</option><option value="en">English (en)</option><option value="zh">中文 (zh)</option>
      </select>
      <button className="pill-button primary" disabled={busy || isGenerating || !voiceId} onClick={preview}>Nghe thử giọng</button>
    </div></div>
    <p className="narration-description">Vibi ElevenLabs tự cân bằng tốc độ đọc theo model và giọng đã chọn. Mỗi lần nghe thử/tạo audio có thể tính credit.</p>
    <div className="vibi-settings-grid">
      {[['stability', 'Độ ổn định'], ['similarityBoost', 'Độ tương đồng'], ['style', 'Phong cách']].map(([key, label]) => {
        const min = 0; const max = 1; const step = 0.01;
        return <label key={key}>{label}: <input type="range" min={min} max={max} step={step} value={voiceSettings[key]} disabled={busy || isGenerating} onChange={event => updateSetting(key, Number(event.target.value))} /> <span>{Number(voiceSettings[key]).toFixed(2)}</span></label>;
      })}
    </div>
    <div className="vibi-options-grid">
      <div className="vibi-option-card">
        <div className="vibi-option-copy">
          <strong>Tăng cường speaker</strong>
          <span>Làm giọng rõ và nổi bật hơn khi phát trong video.</span>
        </div>
        <MaterialSwitch
          id="vibi-speaker-boost"
          checked={voiceSettings.useSpeakerBoost}
          onChange={event => updateSetting('useSpeakerBoost', event.target.checked)}
          disabled={busy || isGenerating}
          ariaLabel="Tăng cường speaker"
          icons={true}
        />
      </div>
      <div className="vibi-option-card">
        <div className="vibi-option-copy">
          <strong>Xuất transcript</strong>
          <span>Tạo transcript kèm audio để tải xuống và kiểm tra lại nội dung.</span>
        </div>
        <MaterialSwitch
          id="vibi-export-transcript"
          checked={exportTranscript}
          onChange={event => setExportTranscript(event.target.checked)}
          disabled={busy || isGenerating}
          ariaLabel="Xuất transcript từ Vibi"
          icons={true}
        />
      </div>
    </div>
    <audio ref={previewAudio} preload="none" aria-hidden="true" style={{ display: 'none' }} />
    {children}
    <GenerateButton handleGenerateNarration={() => generate()} isGenerating={isGenerating || busy}
      requiresReferenceAudio={false} isServiceAvailable={!!apiKey() && catalogLoaded && !!modelId && !!voiceId} subtitleSource={subtitleSource}
      cancelGeneration={() => controller.current?.abort()} generationResults={generationResults}
      downloadAllAudio={downloadAllAudio} downloadAlignedAudio={downloadAlignedAudio} />
    {message && <p role="status">{message}</p>}
    <NarrationResults generationResults={generationResults} retryingSubtitleId={retrying}
      onRetry={id => { if (!controller.current) { setRetrying(id); generate([id]); } }}
      onRetryFailed={() => generate(generationResults.filter(result => !result.success).map(result => result.subtitle_id))}
      hasGenerationError={generationResults.some(result => !result.success)} currentAudio={currentAudio}
      isPlaying={isPlaying} playAudio={playAudio} getAudioUrl={getAudioUrl} subtitleSource={subtitleSource} />
    <audio ref={audioRef} src={currentAudio?.url} onEnded={handleAudioEnded} style={{ display: 'none' }} />
  </div>;
}
