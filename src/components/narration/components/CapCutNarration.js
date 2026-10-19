import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config';
import { getAudioUrl } from '../../../services/narrationService';
import { buildDubbingWindows } from '../../../utils/adaptiveDubbing';
import {
  generateNarrationInputHash,
  getCurrentMediaCacheId,
  readMediaCacheEntries,
  writeMediaCacheEntry
} from '../../../utils/mediaCacheIdentity';
import GenerateButton from './GenerateButton';
import NarrationResults from './NarrationResults';

const CAPCUT_VOICE_CACHE_KEY = 'capcut_voice_catalog_v1';
const CAPCUT_NARRATION_CACHE_KEY = 'capcut_narration_cache_v1';

const toStoredNarration = result => ({
  subtitle_id: result.subtitle_id,
  filename: result.filename,
  success: result.success,
  text: result.text,
  method: result.method,
  voice: result.voice,
  start: result.start,
  end: result.end,
  original_ids: result.original_ids,
  sourceId: result.sourceId,
  timingVersion: result.timingVersion,
  standaloneText: result.standaloneText,
  error: result.error,
});

const publishNarrations = (results, source, grouped) => {
  if (grouped) {
    window.groupedNarrations = [...results];
    window.useGroupedSubtitles = true;
    return;
  }

  if (source === 'translated') window.translatedNarrations = [...results];
  else window.originalNarrations = [...results];
  window.useGroupedSubtitles = false;
};

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

export default function CapCutNarration({ children, getSubtitles, videoDuration, subtitleSource, isGenerating,
  setIsGenerating, generationResults, setGenerationResults, downloadAllAudio, downloadAlignedAudio,
  currentAudio, isPlaying, playAudio, useGroupedSubtitles, audioRef, handleAudioEnded,
  standaloneTextMode = false, isInputValid = true, combinedAudioLabel = '', combinedAudioTooltip = '' }) {
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
  const selectedSubtitlesForCache = standaloneTextMode
    ? []
    : buildDubbingWindows(getSubtitles?.() || [], videoDuration);
  const subtitleInputHash = standaloneTextMode ? '' : generateNarrationInputHash(selectedSubtitlesForCache);

  useEffect(() => {
    if (standaloneTextMode || !subtitleInputHash || !generationResults?.length) return undefined;
    if (generationResults.some(result => result.method !== 'capcut')) return undefined;

    let cancelled = false;
    const saveResults = async () => {
      const mediaId = await getCurrentMediaCacheId();
      if (!mediaId || cancelled) return;
      const cacheId = JSON.stringify([mediaId, 'capcut', subtitleSource, subtitleInputHash]);
      writeMediaCacheEntry(CAPCUT_NARRATION_CACHE_KEY, {
        cacheId,
        mediaId,
        method: 'capcut',
        subtitleSource,
        subtitleHash: subtitleInputHash,
        timestamp: Date.now(),
        results: generationResults.map(toStoredNarration),
      }, 16);
    };

    saveResults().catch(error => console.error('Error saving CapCut narration cache:', error));
    return () => { cancelled = true; };
  }, [generationResults, getSubtitles, standaloneTextMode, subtitleInputHash, subtitleSource]);

  useEffect(() => {
    const hasCapCutResults = generationResults?.some(result => result.method === 'capcut');
    if (standaloneTextMode || busy || isGenerating || !subtitleInputHash || hasCapCutResults) return undefined;

    let cancelled = false;
    const loadResults = async () => {
      const mediaId = await getCurrentMediaCacheId();
      if (!mediaId || cancelled) return;
      const cacheId = JSON.stringify([mediaId, 'capcut', subtitleSource, subtitleInputHash]);
      const cacheEntry = readMediaCacheEntries(CAPCUT_NARRATION_CACHE_KEY).find(entry =>
        entry.cacheId === cacheId
        || (entry.mediaId === mediaId && entry.method === 'capcut'
          && entry.subtitleSource === subtitleSource && entry.subtitleHash === subtitleInputHash)
      );
      if (!cacheEntry?.results?.length || cancelled) return;

      const results = cacheEntry.results.filter(result => result && result.method === 'capcut');
      if (!results.length || cancelled) return;
      setGenerationResults(results);
      const grouped = results.some(result => result.original_ids?.length > 1);
      publishNarrations(results, subtitleSource, grouped);
      window.dispatchEvent(new CustomEvent('narrations-updated', {
        detail: { source: subtitleSource, narrations: results, fromCache: true, isGrouped: grouped }
      }));
      setMessage('Đã khôi phục thuyết minh CapCut đã tạo cho dự án này.');
    };

    loadResults().catch(error => console.error('Error loading CapCut narration cache:', error));
    return () => { cancelled = true; };
  }, [busy, generationResults, getSubtitles, isGenerating, setGenerationResults, standaloneTextMode, subtitleInputHash, subtitleSource]);

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

  const generate = (onlyIds, textOverrides = {}) => run(async signal => {
    const selected = standaloneTextMode
      ? (getSubtitles() || [])
      : buildDubbingWindows(getSubtitles() || [], videoDuration);
    if (!selected.length) throw new Error('Chưa có phụ đề để tạo thuyết minh.');
    const results = onlyIds ? [...generationResults] : [];
    const pending = (onlyIds ? selected.filter(s => onlyIds.some(id => String(id) === String(s.id))) : selected)
      .map(subtitle => {
        const text = textOverrides[String(subtitle.id)];
        return typeof text === 'string' ? { ...subtitle, text, translated_text: text } : subtitle;
      });
    if (!onlyIds) setGenerationResults([]);
    for (let index = 0; index < pending.length; index += 1) {
      signal.throwIfAborted();
      const subtitle = pending[index];
      setMessage(`CapCut: ${index + 1}/${pending.length}`);
      let result;
      try {
        const previous = onlyIds && results.find(r => String(r.subtitle_id) === String(subtitle.id));
        const reusable = typeof textOverrides[String(subtitle.id)] !== 'string'
          && previous?.success && previous.filename && previous.voice === voice
          && (previous.originalNarration?.text || previous.text) === (subtitle.text || subtitle.translated_text)
          && (standaloneTextMode || (previous.start === subtitle.start && previous.end === subtitle.end));
        const audio = reusable ? previous : await synthesize(subtitle.text || subtitle.translated_text, signal);
        result = {
          ...audio,
          subtitle_id: subtitle.id,
          text: typeof textOverrides[String(subtitle.id)] === 'string'
            ? textOverrides[String(subtitle.id)]
            : (audio.text || subtitle.text || subtitle.translated_text),
          method: 'capcut',
          voice,
          ...(standaloneTextMode ? { standaloneText: true } : {
            start: subtitle.start,
            end: subtitle.end,
            original_ids: subtitle.original_ids,
            sourceId: subtitle.sourceId,
            timingVersion: 1
          })
        };
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.capcutCode === '40402004') markVoiceInactive(error.capcutVoice || voice);
        result = { success: false, ...(standaloneTextMode ? { standaloneText: true } : { timingVersion: 1 }), subtitle_id: subtitle.id, text: subtitle.text, error: error.message };
      }
      signal.throwIfAborted();
      const oldIndex = results.findIndex(r => String(r.subtitle_id) === String(subtitle.id));
      if (oldIndex >= 0) results[oldIndex] = result; else results.push(result);
      setGenerationResults([...results]);
      const grouped = useGroupedSubtitles || results.some(item => item.original_ids?.length > 1);
      publishNarrations(results, subtitleSource, grouped);
      window.dispatchEvent(new CustomEvent('narrations-updated', {
        detail: { source: subtitleSource, narrations: [...results], isGrouped: grouped }
      }));
    }
    const failed = results.filter(r => !r.success).length;
    setMessage(failed ? `${failed} câu lỗi. Có thể thử lại từng câu.` : standaloneTextMode ? 'Đã tạo xong audio thuyết minh CapCut từ văn bản.' : 'Đã tạo xong thuyết minh CapCut.');
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
    <p className="narration-description">{standaloneTextMode
      ? 'Văn bản được gửi đến dịch vụ CapCut để tạo audio riêng, không căn theo timeline video.'
      : 'Văn bản được gửi đến dịch vụ CapCut để tạo giọng. Không cần âm thanh tham chiếu. Hãy nghe thử voice trước khi tạo hàng loạt.'}</p>
    <audio ref={previewAudio} preload="auto" aria-hidden="true" style={{ display: 'none' }} />
    {children}
    <GenerateButton handleGenerateNarration={() => generate()} isGenerating={isGenerating || busy}
      requiresReferenceAudio={false} isServiceAvailable={!!voice} subtitleSource={subtitleSource}
      cancelGeneration={() => controller.current?.abort()} generationResults={generationResults}
      downloadAllAudio={downloadAllAudio} downloadAlignedAudio={downloadAlignedAudio}
      isInputValid={isInputValid} inputValidationMessage="Nhập văn bản cần đọc trước khi tạo audio."
      standaloneTextMode={standaloneTextMode}
      combinedAudioLabel={combinedAudioLabel} combinedAudioTooltip={combinedAudioTooltip} />
    {message && <p role="status">{message}</p>}
    <NarrationResults generationResults={generationResults} retryingSubtitleId={retrying} isGenerating={isGenerating || busy}
      onRetry={(id, text) => {
        if (controller.current) return;
        setRetrying(id);
        return generate([id], typeof text === 'string' ? { [String(id)]: text } : {});
      }}
      onRetryFailed={() => generate(generationResults.filter(r => !r.success).map(r => r.subtitle_id))}
      hasGenerationError={generationResults.some(r => !r.success)} currentAudio={currentAudio}
      isPlaying={isPlaying} playAudio={playAudio} getAudioUrl={getAudioUrl} subtitleSource={subtitleSource}
      title={standaloneTextMode ? 'Thuyết minh từ văn bản' : undefined} standaloneTextMode={standaloneTextMode} />
    <audio ref={audioRef} src={currentAudio?.url} onEnded={handleAudioEnded} style={{ display: 'none' }} />
  </div>;
}
