const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../shared/ffmpegUtils');

const run = (binary, args, signal, timeoutMs = 30 * 60 * 1000) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Đã hủy đồng bộ'));
  const child = spawn(binary, args, { windowsHide: true });
  let output = '', errors = '';
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  child.stdout.on('data', data => { output = (output + data).slice(-100000); });
  child.stderr.on('data', data => { errors = (errors + data).slice(-8000); });
  child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  child.on('close', code => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (signal?.aborted) reject(new Error('Đã hủy đồng bộ'));
    else if (code !== 0) reject(new Error(errors || `Media process exited: ${code}`));
    else resolve(output);
  });
});

const probe = async filename => {
  const data = JSON.parse(await run(getFfprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], null, 15000));
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media has no valid duration');
  return { duration, video: data.streams.find(item => item.codec_type === 'video'),
    audio: data.streams.find(item => item.codec_type === 'audio') };
};

const stamp = (seconds, kind) => {
  const milliseconds = Math.round(seconds * (kind === 'ass' ? 100 : 1000));
  const scale = kind === 'ass' ? 100 : 1000;
  const s = Math.floor(milliseconds / scale);
  const decimal = String(milliseconds % scale).padStart(kind === 'ass' ? 2 : 3, '0');
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${kind === 'srt' ? ',' : '.'}${decimal}`;
};

const writeSubtitles = async (directory, subtitles) => {
  for (const [source, items] of Object.entries(subtitles)) {
    if (!['original', 'translated'].includes(source)) continue;
    const clean = text => String(text || '').replace(/\r/g, '').replace(/\n\s*\n/g, '\n');
    for (const kind of ['srt', 'vtt']) {
      const body = items.map((item, index) => `${index + 1}\n${stamp(item.start, kind)} --> ${stamp(item.end, kind)}\n${kind === 'vtt' ? clean(item.text).replace(/&/g, '&amp;').replace(/</g, '&lt;') : clean(item.text)}\n`).join('\n');
      await fs.promises.writeFile(path.join(directory, `${source}.${kind}`), (kind === 'vtt' ? 'WEBVTT\n\n' : '') + body);
    }
    const header = '[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,30,30,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
    const body = items.map(item => `Dialogue: 0,${stamp(item.start, 'ass')},${stamp(item.end, 'ass')},Default,,0,0,0,,${clean(item.text).replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').replace(/\n/g, '\\N')}`).join('\n');
    await fs.promises.writeFile(path.join(directory, `${source}.ass`), header + body);
  }
};

const renderPlan = async (plan, directory, signal, progress) => {
  const ffmpeg = async (args, graph, scriptName) => {
    const script = path.join(directory, scriptName);
    await fs.promises.writeFile(script, graph);
    return run(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args.slice(0, -1), '-filter_complex_script', script, args[args.length - 1]], signal);
  };
  const fpsParts = (plan.source.video.avg_frame_rate || '30/1').split('/').map(Number);
  const fps = fpsParts[0] / (fpsParts[1] || 1);
  const frameRate = Number.isFinite(fps) && fps >= 1 && fps <= 120 ? fps : 30;
  progress(5, 'Đang đổi thời gian hình ảnh');
  const expression = '(PTS-STARTPTS)' + plan.warps.map(w => `+${w.factor - 1}*clip((PTS-STARTPTS)*TB-${w.start},0,${w.end - w.start})/TB`).join('');
  await ffmpeg(['-i', plan.source.path, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(directory, 'picture.mp4')],
    `[0:v]settb=AVTB,setpts='${expression}',fps=${frameRate},pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`, 'picture.filter');
  progress(35, 'Đang đổi thời gian âm thanh gốc');
  const boundaries = [...new Set([0, plan.sourceDuration, ...plan.warps.flatMap(w => [w.start, w.end])])].sort((a, b) => a - b);
  const intervals = boundaries.slice(1).map((end, i) => ({ start: boundaries[i], end,
    factor: plan.warps.find(w => w.start <= boundaries[i] && w.end >= end)?.factor || 1 }));
  let originalGraph;
  const originalArgs = plan.source.audio ? ['-i', plan.source.path] : ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${plan.sourceDuration}`];
  originalGraph = intervals.map((w, i) => `[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${w.start}:end=${w.end},asetpts=PTS-STARTPTS,atempo=${1 / w.factor},apad,atrim=duration=${(w.end - w.start) * w.factor}[a${i}]`).join(';');
  originalGraph += ';' + intervals.map((_, i) => `[a${i}]`).join('') + `concat=n=${intervals.length}:v=0:a=1[a]`;
  await ffmpeg([...originalArgs, '-map', '[a]', '-c:a', 'pcm_s16le', path.join(directory, 'original.wav')], originalGraph, 'original.filter');
  progress(55, 'Đang đặt thuyết minh vào timeline mới');
  const parts = [];
  for (let offset = 0; offset < plan.placements.length; offset += 40) {
    const batch = plan.placements.slice(offset, offset + 40);
    const voiceArgs = ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${plan.outputDuration}`];
    batch.forEach(item => voiceArgs.push('-i', path.join(directory, item.rawFile)));
    let voiceGraph = batch.map((item, i) => `[${i + 1}:a]${item.audioStart !== undefined ? `atrim=start=${item.audioStart}:end=${item.audioEnd},asetpts=PTS-STARTPTS,` : ''}aresample=48000,aformat=channel_layouts=stereo,atempo=${item.tempo},adelay=${Math.round(item.outStart * 48000)}S:all=1[v${i}]`).join(';');
    voiceGraph += ';[0:a]' + batch.map((_, i) => `[v${i}]`).join('') + `amix=inputs=${batch.length + 1}:duration=longest:normalize=0[voice]`;
    const filename = path.join(directory, `voice-part-${parts.length}.wav`);
    await ffmpeg([...voiceArgs, '-map', '[voice]', '-c:a', 'pcm_s16le', filename], voiceGraph, `voice-${parts.length}.filter`);
    parts.push(filename);
  }
  const mixParts = parts.flatMap(filename => ['-i', filename]);
  await ffmpeg([...mixParts, '-map', '[voice]', '-c:a', 'pcm_s16le', path.join(directory, 'voice.wav')],
    parts.map((_, i) => `[${i}:a]`).join('') + `amix=inputs=${parts.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=false:latency=1[voice]`, 'voice.filter');
  progress(75, 'Đang tạo video xem trước và phụ đề');
  await run(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(directory, 'picture.mp4'), '-i', path.join(directory, 'original.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', path.join(directory, 'video.mp4')], signal);
  await ffmpeg(['-i', path.join(directory, 'video.mp4'), '-i', path.join(directory, 'voice.wav'), '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', path.join(directory, 'preview.mp4')],
    `[0:a]volume=${plan.options.originalVolume}[bg];[1:a]volume=${plan.options.voiceVolume}[vox];[bg][vox]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=false:latency=1[mix]`, 'mix.filter');
  await writeSubtitles(directory, plan.mappedSubtitles);
  const output = await probe(path.join(directory, 'preview.mp4'));
  if (Math.abs(output.duration - plan.outputDuration) > 1 / frameRate + 0.03) throw new Error('Output media duration does not match SyncPlan');
  if (signal?.aborted) throw new Error('Đã hủy đồng bộ');
  return { frameRate };
};

module.exports = { run, probe, renderPlan, writeSubtitles };
