import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from capcut_tts_api import CapCutClient

ROOT = Path(__file__).resolve().parents[2]
REVISION = 'e06da1f4e0c0010354f4e7702f02c18cbdd419a2'
CATALOG = ROOT / '.venv-capcut' / 'Voice.json'
OUTPUT = ROOT / 'narration' / 'output' / 'capcut'


class RetryingSession(requests.Session):
    def request(self, method, url, **kwargs):
        for attempt in range(4):
            try:
                response = super().request(method, url, **kwargs)
                if response.status_code != 429 and response.status_code < 500:
                    return response
                if attempt == 3:
                    raise RuntimeError(f'CapCut HTTP {response.status_code}; retry limit reached')
                retry_after = response.headers.get('Retry-After', '')
            except (requests.Timeout, requests.ConnectionError):
                if attempt == 3:
                    raise RuntimeError('CapCut connection failed after retries') from None
                retry_after = ''
            delay = float(retry_after) if retry_after.isdigit() else (5, 15, 45)[attempt]
            if delay > 120:
                raise RuntimeError(f'CapCut rate limit; try again after {delay:.0f} seconds')
            time.sleep(delay)


def checked(response):
    if str(response.get('ret', '0')) != '0':
        raise RuntimeError(f"CapCut error {response.get('ret')}: {str(response.get('errmsg', 'Request rejected'))[:250]}")
    return response


def run(data):
    client = CapCutClient(session=RetryingSession(), device=os.getenv('CAPCUT_DEVICE_CONFIG') or None)
    voices = client.list_voices(catalog_path=CATALOG)
    if data.get('action') == 'voices':
        return {'voices': [{'id': v.voice_type, 'name': v.display_name, 'language': v.lang or v.lan,
                            'verified': False} for v in voices]}
    text = str(data.get('text') or '').strip()
    voice = next((v for v in voices if v.voice_type == data.get('voice')), None)
    if not text or len(text) > 5000 or not voice:
        raise ValueError('Choose a catalog voice and enter 1–5000 characters')
    key = hashlib.sha256(json.dumps([REVISION, text, voice.voice_type, voice.resource_id], ensure_ascii=False).encode()).hexdigest()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / f'{key}.wav'
    metadata = target.with_suffix('.json')
    if target.exists() and metadata.exists():
        try:
            saved = json.loads(metadata.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            saved = {}
        if saved.get('hash') == hashlib.sha256(target.read_bytes()).hexdigest():
            return {'filename': f'capcut/{target.name}', 'cache_hit': True, 'success': True}
    task = checked(client.create_tts_task(text, voice.voice_type, voice.resource_id))['data']['tasks'][0]
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        tasks = checked(client.query_tts_task(task['id'], task['token']))['data']['tasks']
        result = next((item for item in tasks if item['id'] == task['id']), None)
        if result and result.get('status') in ('success', 'succeed'):
            break
        if result and result.get('status') in ('failed', 'fail', 'cancelled'):
            raise RuntimeError('CapCut synthesis failed; choose another voice or check your session')
        time.sleep(1)
    else:
        raise TimeoutError('CapCut task did not finish within 120 seconds')
    payload = result['payload']
    payload = json.loads(payload) if isinstance(payload, str) else payload
    clips = payload.get('audio_subtitles', [])
    if len(clips) != 1 or clips[0].get('code', 0) != 0 or clips[0].get('invalid_input'):
        raise RuntimeError('CapCut returned invalid or missing audio')
    url = clips[0].get('speech_url', '')
    host = urlparse(url).hostname or ''
    if urlparse(url).scheme != 'https' or not any(host.endswith('.' + domain) for domain in ('tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com')):
        raise RuntimeError('Unexpected CapCut audio host')
    with client.session.get(url, timeout=30, stream=True, allow_redirects=False) as response:
        if response.status_code != 200:
            raise RuntimeError(f'CapCut audio download HTTP {response.status_code}')
        with tempfile.TemporaryDirectory(dir=OUTPUT) as directory:
            source = Path(directory) / 'raw.mp3'
            size = 0
            with source.open('wb') as output:
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 50 * 1024 * 1024:
                        raise RuntimeError('CapCut audio exceeds size limit')
                    output.write(chunk)
            wav = Path(directory) / 'audio.wav'
            subprocess.run([os.getenv('FFMPEG_PATH', 'ffmpeg'), '-v', 'error', '-y', '-i', str(source),
                            '-vn', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True, capture_output=True, timeout=60)
            if wav.stat().st_size < 128:
                raise RuntimeError('CapCut returned empty audio')
            digest = hashlib.sha256(wav.read_bytes()).hexdigest()
            wav.replace(target)
    temporary = metadata.with_suffix('.tmp')
    temporary.write_text(json.dumps({'hash': digest, 'voice': voice.voice_type, 'revision': REVISION}), encoding='utf-8')
    temporary.replace(metadata)
    return {'success': True, 'filename': f'capcut/{target.name}', 'cache_hit': False}


if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        message = str(error) if isinstance(error, (ValueError, RuntimeError, TimeoutError)) else type(error).__name__
        print(json.dumps({'error': message[:400]}, ensure_ascii=False))
        sys.exit(1)
