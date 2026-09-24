import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config';
import { getAudioUrl } from '../../../services/narrationService';
import GenerateButton from './GenerateButton';
import NarrationResults from './NarrationResults';

export default function CapCutNarration({ children, getSubtitles, subtitleSource, isGenerating,
  setIsGenerating, generationResults, setGenerationResults, downloadAllAudio, downloadAlignedAudio,
  currentAudio, isPlaying, playAudio, useGroupedSubtitles }) {
  const [voices, setVoices] = useState([]);
  const [language, setLanguage] = useState('vi-VN');
  const [voice, setVoice] = useState(() => localStorage.getItem('capcut_voice') || 'BV421_vivn_streaming');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
    if (!response.ok || result.error) throw new Error(result.error || `CapCut HTTP ${response.status}`);
    return result;
  };

  const run = async (operation, generating = false) => {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setMessage('Đang xử lý CapCut…');
    if (generating) setIsGenerating(true);
    try { await operation(active.signal); }
    catch (error) {
      if (mounted.current) setMessage(error.name === 'AbortError' ? 'Đã dừng chờ tại máy. Task đã gửi có thể vẫn chạy trên CapCut.' : error.message);
    } finally {
      controller.current = null;
      if (generating) setIsGenerating(false);
      if (mounted.current) { setBusy(false); setRetrying(null); }
    }
  };

  const loadVoices = () => run(async signal => {
    const result = await request('voices', null, signal);
    setVoices(result.voices);
    setMessage(`Đã tải ${result.voices.length} giọng từ danh mục. Nghe thử để xác nhận từng giọng hoạt động.`);
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

  const languages = [...new Set(voices.map(v => v.language))].filter(Boolean).sort();
  return <div className="capcut-content">
    <div className="narration-row"><div className="row-label">Ngôn ngữ giọng:</div><div className="row-content">
      <select aria-label="Ngôn ngữ giọng CapCut" className="pill-button secondary" value={language} disabled={busy || isGenerating}
        onChange={event => { const lang = event.target.value; setLanguage(lang); setVoice(voices.find(v => v.language === lang)?.id || ''); }}>
        {!languages.includes(language) && <option value={language}>{language}</option>}
        {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
      </select>
    </div></div>
    <div className="narration-row"><div className="row-label">Giọng CapCut:</div><div className="row-content">
      <select aria-label="Giọng CapCut" className="pill-button secondary" value={voice} disabled={busy || isGenerating}
        onChange={event => { setVoice(event.target.value); localStorage.setItem('capcut_voice', event.target.value); }}>
        {!voices.some(v => v.id === voice && v.language === language) && <option value={voice}>{voice || 'Chọn giọng'}</option>}
        {voices.filter(v => v.language === language).map(v => <option key={`${v.id}-${v.name}`} value={v.id}>{v.name}</option>)}
      </select>
      <button className="pill-button secondary" disabled={busy || isGenerating} onClick={loadVoices}>Tải danh sách giọng</button>
      <button className="pill-button primary" disabled={busy || isGenerating || !voice} onClick={listen}>Nghe thử giọng</button>
    </div></div>
    <p className="narration-description">Văn bản được gửi đến dịch vụ CapCut để tạo giọng. Không cần âm thanh tham chiếu.</p>
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
  </div>;
}
