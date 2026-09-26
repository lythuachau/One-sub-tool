import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config';
import { getAudioUrl } from '../../../services/narrationService';
import GenerateButton from './GenerateButton';
import NarrationResults from './NarrationResults';

const CAPCUT_VOICE_CACHE_KEY = 'capcut_voice_catalog_v1';

const readVoiceCatalogCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(CAPCUT_VOICE_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.voices)) return null;
    const inactiveIds = Array.isArray(cached.inactiveIds) ? cached.inactiveIds : [];
    const inactive = new Set(inactiveIds);
    return {
      ...cached,
      inactiveIds,
      voices: cached.voices.filter(item => item && item.capcut_supported !== false && !inactive.has(item.id)),
    };
  } catch {
    return null;
  }
};

const writeVoiceCatalogCache = (voices, catalogRevision, inactiveIds = []) => {
  try {
    localStorage.setItem(CAPCUT_VOICE_CACHE_KEY, JSON.stringify({
      schema: 1,
      catalogRevision: catalogRevision || 'unknown',
      updatedAt: new Date().toISOString(),
      inactiveIds: [...new Set(inactiveIds)],
      voices,
    }));
  } catch {
    return false;
  }
  return true;
};

export default function CapCutNarration({ children, getSubtitles, subtitleSource, isGenerating,
  setIsGenerating, generationResults, setGenerationResults, downloadAllAudio, downloadAlignedAudio,
  currentAudio, isPlaying, playAudio, useGroupedSubtitles, audioRef, handleAudioEnded }) {
  const [cachedCatalog] = useState(readVoiceCatalogCache);
  const [voices, setVoices] = useState(() => cachedCatalog?.voices || []);
  const [language, setLanguage] = useState('vi-VN');
  const [voice, setVoice] = useState(() => localStorage.getItem('capcut_voice') || 'BV421_vivn_streaming');
  const [busy, setBusy] = useState(false);
  const [catalogCached, setCatalogCached] = useState(() => Boolean(cachedCatalog?.voices?.length));
  const [message, setMessage] = useState(() => cachedCatalog?.voices?.length
    ? `Đã dùng ${cachedCatalog.voices.length} giọng CapCut đã lưu. Bấm “Làm mới danh sách giọng” để cập nhật.`
    : '');
  const [retrying, setRetrying] = useState(null);
  const controller = useRef(null);
  const previewAudio = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const audioElement = previewAudio.current;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (audioElement) {
        audioElement.pause();
        audioElement.removeAttribute('src');
        audioElement.load();
      }
    };
  }, []);

  const request = async (endpoint, body, signal) => {
    const response = await fetch(`${API_BASE_URL}/narration/capcut/${endpoint}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal
    });
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const hint = response.status === 404
        ? ' Backend chưa nạp route CapCut; hãy khởi động lại bằng npm run dev:cuda.'
        : '';
      throw new Error(`CapCut API trả về dữ liệu không phải JSON (HTTP ${response.status}, ${contentType}).${hint}`);
    }
    if (!response.ok || result.error) {
      const details = [
        result.code ? `Mã ${result.code}` : '',
        result.api_message ? String(result.api_message) : '',
        result.failed_node ? `Node ${result.failed_node}` : '',
      ].filter(Boolean).join(' · ');
      const error = new Error(`${result.error || `CapCut HTTP ${response.status}`}${details ? ` — ${details}` : ''}`);
      error.capcutCode = result.code ? String(result.code) : '';
      error.capcutVoice = body?.voice || '';
      throw error;
    }
    return result;
  };

  const markVoiceInactive = voiceId => {
    if (!voiceId) return;
    const cached = readVoiceCatalogCache();
    const catalogRevision = cached?.catalogRevision || '';
    const inactiveIds = [...new Set([...(cached?.inactiveIds || []), voiceId])];
    const nextVoices = (cached?.voices || voices).filter(item => item.id !== voiceId);
    writeVoiceCatalogCache(nextVoices, catalogRevision, inactiveIds);
    setVoices(nextVoices);
    if (voice === voiceId) {
      const replacement = nextVoices.find(item => item.language === language) || nextVoices[0];
      setVoice(replacement?.id || '');
      if (replacement) localStorage.setItem('capcut_voice', replacement.id);
      else localStorage.removeItem('capcut_voice');
    }
  };

  useEffect(() => {
    if (!voices.length) return;
    const selected = voices.find(item => item.id === voice && item.language === language);
    if (!selected) {
      const replacement = voices.find(item => item.language === language) || voices[0];
      if (replacement) {
        setVoice(replacement.id);
        localStorage.setItem('capcut_voice', replacement.id);
      }
    }
  }, [voices, language, voice]);

  const run = async (operation, generating = false) => {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setMessage('Đang xử lý CapCut…');
    if (generating) setIsGenerating(true);
    try { await operation(active.signal); }
    catch (error) {
      if (error.capcutCode === '40402004') markVoiceInactive(error.capcutVoice || voice);
      if (mounted.current) setMessage(error.name === 'AbortError' ? 'Đã dừng chờ tại máy. Task đã gửi có thể vẫn chạy trên CapCut.' : error.message);
    } finally {
      controller.current = null;
      if (generating) setIsGenerating(false);
      if (mounted.current) { setBusy(false); setRetrying(null); }
    }
  };

  const loadVoices = () => run(async signal => {
    const result = await request('voices', null, signal);
    const previous = readVoiceCatalogCache();
    const sameRevision = previous?.catalogRevision && previous.catalogRevision === result.catalog_revision;
    const inactiveIds = sameRevision ? (previous.inactiveIds || []) : [];
    const refreshedVoices = result.voices.filter(item => !inactiveIds.includes(item.id));
    writeVoiceCatalogCache(refreshedVoices, result.catalog_revision, inactiveIds);
    setVoices(refreshedVoices);
    setCatalogCached(true);
    const matchingVoice = refreshedVoices.find(item => item.id === voice && item.language === language);
    if (!matchingVoice) {
      const replacement = refreshedVoices.find(item => item.language === language) || refreshedVoices[0];
      if (replacement) {
        setVoice(replacement.id);
        localStorage.setItem('capcut_voice', replacement.id);
      }
    }
    setMessage(`Đã cập nhật ${refreshedVoices.length} giọng CapCut. Danh sách đã được lưu cho lần sau.`);
  });
  const synthesize = (text, signal) => request('synthesize', { text, voice }, signal);
  const listen = () => run(async signal => {
    const result = await synthesize(language.startsWith('vi') ? 'Xin chào, đây là bản nghe thử giọng CapCut.' : 'Hello, this is a CapCut voice preview.', signal);
    const player = previewAudio.current;
    if (!player) throw new Error('Không khởi tạo được trình phát nghe thử.');
    player.src = getAudioUrl(result.filename);
    player.load();
    try {
      await player.play();
      setMessage('Đang phát bản nghe thử giọng CapCut.');
    } catch {
      setMessage('Audio đã tạo xong nhưng trình duyệt chặn tự phát. Hãy bấm Nghe thử giọng lại.');
    }
  });

  const generate = (onlyIds) => run(async signal => {
    const selected = (getSubtitles() || []).map((subtitle, index) => ({ ...subtitle, id: subtitle.id ?? index + 1 }));
    if (!selected.length) throw new Error('Chưa có phụ đề để tạo thuyết minh.');
    const results = onlyIds ? [...generationResults] : [];
    const pending = onlyIds ? selected.filter(s => onlyIds.some(id => String(id) === String(s.id))) : selected;
    if (!onlyIds) setGenerationResults([]);
    for (let index = 0; index < pending.length; index += 1) {
      signal.throwIfAborted();
      const subtitle = pending[index];
      setMessage(`CapCut: ${index + 1}/${pending.length}`);
      let result;
      try {
        const audio = await synthesize(subtitle.text || subtitle.translated_text, signal);
        result = { ...audio, subtitle_id: subtitle.id, text: subtitle.text || subtitle.translated_text,
          start: subtitle.start, end: subtitle.end, method: 'capcut', voice };
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.capcutCode === '40402004') markVoiceInactive(error.capcutVoice || voice);
        result = { success: false, subtitle_id: subtitle.id, text: subtitle.text, error: error.message };
      }
      signal.throwIfAborted();
      const oldIndex = results.findIndex(r => String(r.subtitle_id) === String(subtitle.id));
      if (oldIndex >= 0) results[oldIndex] = result; else results.push(result);
      setGenerationResults([...results]);
      if (useGroupedSubtitles) { window.groupedNarrations = [...results]; window.useGroupedSubtitles = true; }
    }
    const failed = results.filter(r => !r.success).length;
    setMessage(failed ? `${failed} câu lỗi. Có thể thử lại từng câu.` : 'Đã tạo xong thuyết minh CapCut.');
  }, true);

  const availableVoices = voices.filter(item => item.capcut_supported !== false);
  const languages = [...new Set(availableVoices.map(v => v.language))].filter(Boolean).sort();
  const languageVoices = availableVoices.filter(v => v.language === language);
  return <div className="capcut-content">
    <div className="narration-row"><div className="row-label">Ngôn ngữ giọng:</div><div className="row-content">
      <select aria-label="Ngôn ngữ giọng CapCut" className="pill-button secondary" value={language} disabled={busy || isGenerating}
        onChange={event => { const lang = event.target.value; setLanguage(lang); setVoice(availableVoices.find(v => v.language === lang)?.id || ''); }}>
        {!languages.includes(language) && <option value={language}>{language}</option>}
        {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
      </select>
    </div></div>
    <div className="narration-row"><div className="row-label">Giọng CapCut:</div><div className="row-content">
      <select aria-label="Giọng CapCut" className="pill-button secondary" value={voice} disabled={busy || isGenerating}
        onChange={event => { setVoice(event.target.value); localStorage.setItem('capcut_voice', event.target.value); }}>
        {!languageVoices.some(v => v.id === voice) && <option value={voice}>{voice || 'Chọn giọng'}</option>}
        {languageVoices.map(v => <option key={`${v.id}-${v.name}`} value={v.id}>
          {v.name}
        </option>)}
      </select>
      <button className="pill-button secondary" disabled={busy || isGenerating} onClick={loadVoices}>{catalogCached ? 'Làm mới danh sách giọng' : 'Tải danh sách giọng'}</button>
      <button className="pill-button primary" disabled={busy || isGenerating || !voice} onClick={listen}>Nghe thử giọng</button>
    </div></div>
    <p className="narration-description">Văn bản được gửi đến dịch vụ CapCut để tạo giọng. Không cần âm thanh tham chiếu. Hãy nghe thử voice trước khi tạo hàng loạt.</p>
    <audio ref={previewAudio} preload="auto" aria-hidden="true" style={{ display: 'none' }} />
    {children}
    <GenerateButton handleGenerateNarration={() => generate()} isGenerating={isGenerating || busy}
      requiresReferenceAudio={false} isServiceAvailable={!!voice} subtitleSource={subtitleSource}
      cancelGeneration={() => controller.current?.abort()} generationResults={generationResults}
      downloadAllAudio={downloadAllAudio} downloadAlignedAudio={downloadAlignedAudio} />
    {message && <p role="status">{message}</p>}
    <NarrationResults generationResults={generationResults} retryingSubtitleId={retrying}
      onRetry={id => { if (!controller.current) { setRetrying(id); generate([id]); } }}
      onRetryFailed={() => generate(generationResults.filter(r => !r.success).map(r => r.subtitle_id))}
      hasGenerationError={generationResults.some(r => !r.success)} currentAudio={currentAudio}
      isPlaying={isPlaying} playAudio={playAudio} getAudioUrl={getAudioUrl} subtitleSource={subtitleSource} />
    <audio ref={audioRef} src={currentAudio?.url} onEnded={handleAudioEnded} style={{ display: 'none' }} />
  </div>;
}
