const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NARRATION_DIR, SUBTITLES_DIR } = require('../config');
const { resolveOutputAudioPath, validateWavBuffer, withAudioFileLock } = require('../controllers/narration/audioFile/audioArtifactSafety');
const { createWavHeader } = require('../controllers/narration/geminiAudioController');
const { createSyncPlan, fingerprint } = require('../services/adaptiveSync/planner');
const { probe, renderPlan } = require('../services/adaptiveSync/media');

const router = express.Router();
const root = path.join(NARRATION_DIR, 'sync');
const sources = path.join(root, 'sources');
fs.mkdirSync(sources, { recursive: true });
const migrationFile = path.join(root, 'legacy-projects.json');
if (!fs.existsSync(migrationFile)) {
  const ids = fs.existsSync(SUBTITLES_DIR) ? fs.readdirSync(SUBTITLES_DIR).filter(name => name.endsWith('.json')).flatMap(name => [name.slice(0, -5), name.slice(0, -5).replace(/_(asr_.+|whisper)$/, '')]) : [];
  fs.writeFileSync(migrationFile, JSON.stringify({ ids, migratedAt: Date.now() }));
}
const jobs = new Map();
const uploads = multer({ dest: sources, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const directoryFor = id => { if (!validId(id)) throw new Error('Invalid SyncPlan ID'); return path.join(root, id); };
const hashFile = filename => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(filename).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});
const readPlan = id => JSON.parse(fs.readFileSync(path.join(directoryFor(id), 'plan.json'), 'utf8'));
const writePlan = plan => {
  const filename = path.join(directoryFor(plan.id), 'plan.json');
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(plan));
  fs.renameSync(temporary, filename);
};
const publicPlan = plan => {
  const { source, placements, unresolved, ...rest } = plan;
  const stripPrivate = ({ rawFile, audioHash, originalFilename, ...item }) => item;
  const base = `/api/narration/sync/plans/${plan.id}/artifacts/`;
  return { ...rest, placements: placements.map(stripPrivate), unresolved: unresolved.map(stripPrivate),
    assets: plan.status === 'ready' ? { video: base + 'video.mp4', preview: base + 'preview.mp4',
      voice: base + 'voice.wav', original: base + 'original.wav',
      subtitles: Object.fromEntries(Object.keys(plan.mappedSubtitles).map(key => [key,
        Object.fromEntries(['srt', 'ass', 'vtt'].map(kind => [kind, `${base}${key}.${kind}`]))])) } : null };
};
const handle = operation => async (req, res) => {
  try { await operation(req, res); }
  catch (error) { if (!res.headersSent) res.status(error.code === 'ENOENT' ? 404 : error.status || 422).json({ error: error.message, code: error.syncCode || 'SYNC_FAILED' }); }
};

router.get('/legacy-projects', handle(async (req, res) => res.json(JSON.parse(await fs.promises.readFile(migrationFile, 'utf8')))));

router.post('/source', uploads.single('video'), handle(async (req, res) => {
  if (!req.file) throw new Error('Video source is required');
  try {
    const metadata = await probe(req.file.path);
    if (!metadata.video) throw new Error('The source must contain video');
    const id = await hashFile(req.file.path);
    const target = path.join(sources, id);
    if (!fs.existsSync(target)) await fs.promises.rename(req.file.path, target);
    return res.json({ sourceId: id, duration: metadata.duration });
  } finally { await fs.promises.rm(req.file.path, { force: true }).catch(() => {}); }
}));

router.post('/plans', express.json({ limit: '100mb' }), handle(async (req, res) => {
  const { sourceId, narrations, subtitles = {}, options = {}, subtitleSource = 'original' } = req.body;
  if (!validId(sourceId) || !Array.isArray(narrations) || !narrations.length || narrations.length > 1000) throw new Error('Invalid source or narration list');
  if (!['original', 'translated'].includes(subtitleSource) || Object.keys(subtitles).some(key => !['original', 'translated'].includes(key))) throw new Error('Invalid subtitle source');
  const sourcePath = path.join(sources, sourceId);
  const metadata = await probe(sourcePath);
  const buffers = [];
  let totalBytes = 0;
  const segments = [];
  for (const item of narrations) {
    if (!item.success || (!item.filename && !item.audioData)) throw new Error(`Câu ${item.subtitle_id} chưa có audio hợp lệ`);
    let buffer;
    if (item.filename) {
      const filename = resolveOutputAudioPath(item.filename);
      const backup = path.join(path.dirname(filename), `backup_${path.basename(filename)}`);
      buffer = await fs.promises.readFile(fs.existsSync(backup) ? backup : filename);
    } else {
      buffer = Buffer.from(String(item.audioData).replace(/^data:[^,]+,/, ''), 'base64');
      if (buffer.toString('ascii', 0, 4) !== 'RIFF') buffer = Buffer.concat([createWavHeader(buffer.length, Number(item.sampleRate) || 24000), buffer]);
      validateWavBuffer(buffer);
    }
    if (Array.isArray(item.original_ids) && item.original_ids.length > 1 && !item.cueAlignments?.length) {
      const error = new Error(`Nhóm ${item.subtitle_id} thiếu audio căn chỉnh theo từng cue. Tắt nhóm và tạo lại các câu thành viên trước khi đồng bộ; hệ thống chưa gọi thêm TTS.`);
      error.syncCode = 'SYNC_GROUP_ALIGNMENT_REQUIRED';
      throw error;
    }
    const rawFile = `raw-${buffers.length}.wav`;
    const audioHash = crypto.createHash('sha256').update(buffer).digest('hex');
    totalBytes += buffer.length;
    if (buffer.length > 64 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024) throw new Error('Audio vượt giới hạn xử lý 256MB mỗi kế hoạch hoặc 64MB mỗi câu.');
    buffers.push(buffer);
    segments.push({ id: item.subtitle_id, start: Number(item.start), end: Number(item.end), text: String(item.text || ''), rawFile, audioHash, originalFilename: item.filename || null,
      ...(item.original_ids?.length > 1 ? { originalIds: item.original_ids, cueAlignments: item.cueAlignments } : {}) });
  }
  const id = fingerprint({ schemaVersion: 1, sourceId, segments, subtitles, subtitleSource, options });
  const directory = directoryFor(id);
  return withAudioFileLock(path.join(directory, 'plan.json'), async () => {
  if (fs.existsSync(path.join(directory, 'plan.json'))) return res.json(publicPlan(readPlan(id)));
  await fs.promises.mkdir(directory, { recursive: true });
  for (let i = 0; i < buffers.length; i++) {
    const filename = path.join(directory, segments[i].rawFile);
    await fs.promises.writeFile(filename, buffers[i]);
    const audio = await probe(filename);
    if (!audio.audio) throw new Error(`No audio stream: ${segments[i].id}`);
    segments[i].duration = audio.duration;
  }
  const expanded = segments.flatMap(segment => {
    if (!segment.originalIds) return [segment];
    const cues = segment.cueAlignments;
    if (cues.length !== segment.originalIds.length) throw new Error('Căn chỉnh nhóm chưa đủ các cue thành viên');
    let audioEnd = 0;
    const items = cues.map((cue, index) => {
      const source = (subtitles[subtitleSource] || []).find(item => String(item.id ?? item.subtitle_id) === String(segment.originalIds[index]));
      if (!source || String(cue.subtitle_id) !== String(segment.originalIds[index]) || !Number.isFinite(cue.audioStart)
        || !Number.isFinite(cue.audioEnd) || Math.abs(cue.audioStart - audioEnd) > 0.002 || cue.audioEnd <= cue.audioStart) throw new Error('Mốc căn chỉnh nội bộ nhóm không hợp lệ');
      audioEnd = cue.audioEnd;
      return { id: cue.subtitle_id, start: Number(source.start ?? source.startTime), end: Number(source.end ?? source.endTime),
        text: String(cue.text || source.text || ''), rawFile: segment.rawFile, audioHash: segment.audioHash, originalFilename: segment.originalFilename,
        duration: cue.audioEnd - cue.audioStart, audioStart: cue.audioStart, audioEnd: cue.audioEnd };
    });
    if (Math.abs(audioEnd - segment.duration) > 0.002) throw new Error('Căn chỉnh nhóm chưa bao phủ toàn bộ audio; không tự cắt lời');
    return items;
  });
  const result = createSyncPlan({ segments: expanded, duration: metadata.duration, subtitles, options });
  const plan = { ...result, id, fingerprint: id, sourceId, subtitleSource, status: result.ready ? 'planned' : 'review',
    progress: 0, createdAt: Date.now(), source: { ...metadata, path: sourcePath } };
  writePlan(plan);
  res.json(publicPlan(plan));
  });
}));

router.get('/plans/:id', handle(async (req, res) => {
  const plan = readPlan(req.params.id);
  if (plan.status === 'building' && !jobs.has(plan.id)) { plan.status = 'failed'; plan.error = 'Server đã khởi động lại. Hãy tính lại đồng bộ.'; writePlan(plan); }
  if (plan.status === 'ready') {
    const hashes = new Map();
    for (const item of plan.placements) {
      if (!item.originalFilename) continue;
      const filename = resolveOutputAudioPath(item.originalFilename);
      const backup = path.join(path.dirname(filename), `backup_${path.basename(filename)}`);
      const raw = fs.existsSync(backup) ? backup : filename;
      if (!hashes.has(raw)) hashes.set(raw, await hashFile(raw).catch(() => null));
      const current = hashes.get(raw);
      if (current !== item.audioHash) return res.json(publicPlan({ ...plan, status: 'stale', error: 'Audio đã thay đổi hoặc bị mất. Hãy áp dụng đồng bộ lại.' }));
    }
  }
  res.json(publicPlan(plan));
}));

router.post('/plans/:id/build', handle(async (req, res) => {
  const plan = readPlan(req.params.id);
  if (!plan.ready) throw new Error('Còn câu cần xử lý; chưa thể áp dụng SyncPlan');
  if (plan.status === 'ready' || jobs.has(plan.id)) return res.json(publicPlan(plan));
  if (jobs.size >= 2) { const error = new Error('Đang xử lý hai kế hoạch. Vui lòng thử lại sau.'); error.status = 429; throw error; }
  const controller = new AbortController();
  jobs.set(plan.id, controller);
  plan.status = 'building'; plan.progress = 1; delete plan.error;
  writePlan(plan);
  renderPlan(plan, directoryFor(plan.id), controller.signal, (progress, message) => {
    plan.progress = progress; plan.message = message; writePlan(plan);
  }).then(result => {
    Object.assign(plan, result, { status: 'ready', progress: 100, message: 'Đồng bộ hoàn tất' });
  }).catch(error => { plan.status = controller.signal.aborted ? 'cancelled' : 'failed'; plan.error = error.message; })
    .finally(() => { writePlan(plan); jobs.delete(plan.id); });
  res.status(202).json(publicPlan(plan));
}));

router.delete('/plans/:id/build', handle(async (req, res) => {
  directoryFor(req.params.id);
  jobs.get(req.params.id)?.abort();
  res.json({ cancelled: true });
}));

router.get('/plans/:id/artifacts/:file', handle(async (req, res) => {
  const plan = readPlan(req.params.id);
  if (plan.status !== 'ready') throw new Error('SyncPlan is not ready');
  if (!/^(video\.mp4|preview\.mp4|voice\.wav|original\.wav|(original|translated)\.(srt|ass|vtt))$/.test(req.params.file)) throw new Error('Invalid sync artifact');
  const filename = path.join(directoryFor(plan.id), req.params.file);
  if (req.params.file.endsWith('.vtt')) res.type('text/vtt');
  res.sendFile(filename);
}));

module.exports = router;
