import React from 'react';
import { adaptiveUrl } from '../../services/adaptiveSyncService';

const AdaptiveSyncPreview = ({ plan, onRenderVideo }) => <div className="preview-section adaptive-sync-preview">
  <h3>Xem trước — timeline đồng bộ ({plan.outputDuration.toFixed(2)}s)</h3>
  <video key={plan.id} controls preload="metadata" crossOrigin="anonymous" style={{ width: '100%', maxHeight: 640 }} src={adaptiveUrl(plan.assets.preview)}>
    {Object.entries(plan.assets.subtitles).map(([source, files]) => <track key={source} kind="subtitles" label={source === 'translated' ? 'Phụ đề dịch' : 'Phụ đề gốc'} srcLang={source === 'translated' ? 'vi' : 'und'} src={adaptiveUrl(files.vtt)} default={source === plan.subtitleSource} />)}
  </video>
  <p>Video, audio và phụ đề đang dùng cùng kế hoạch {plan.id.slice(0, 10)}.</p>
  <button className="pill-button" onClick={onRenderVideo}>Render Video</button>
</div>;

export default AdaptiveSyncPreview;
