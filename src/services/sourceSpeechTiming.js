import { API_BASE_URL } from '../config';
import { alignSourceWords } from '../utils/sourceWordAlignment';
let cached = null;

export const prepareSourceSpeech = async (videoUrl, originals, signal, onProgress) => {
  if (!videoUrl) return originals;
  const model = localStorage.getItem('whisper_model') || 'medium';
  const language = localStorage.getItem('source_language') || 'auto';
  const key = JSON.stringify([videoUrl,model,language]);
  let segments = cached?.key === key ? cached.segments : null;
  if (!segments) {
    onProgress?.('Đang nhận dạng mốc từ trong audio gốc bằng Whisper local…');
    const media = await fetch(videoUrl,{signal});
    if(!media.ok) throw new Error('Không đọc được video gốc: HTTP '+media.status);
    const body = new FormData();
    body.append('file',await media.blob(),'source-video.mp4');
    body.append('model',model); body.append('language',language); body.append('device','auto');
    const response = await fetch(API_BASE_URL+'/subtitle-engine/whisper',{method:'POST',body,signal});
    const data = await response.json();
    if(!response.ok || !data.success) throw new Error(data.error || 'Nhận dạng lời gốc thất bại');
    signal?.throwIfAborted();
    segments = data.segments;
    if(!Array.isArray(segments) || !segments.some(s=>s.words?.length)) throw new Error('Whisper chưa trả timestamp từ. Cần khởi động backend phiên bản mới.');
    cached={key,segments};
  }
  return alignSourceWords(originals,segments);
};
