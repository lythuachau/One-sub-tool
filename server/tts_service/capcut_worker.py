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
DEFAULT_VERIFY_TEXT = 'Xin chào, đây là bản kiểm tra giọng CapCut.'
KNOWN_UNSUPPORTED_VOICES = {
    'vi-VN-HoaiMyNeural': 'CapCut trả về TTSInvalidSpeaker cho voice này',
    'vi-VN-NamMinhNeural': 'CapCut trả về TTSInvalidSpeaker cho voice này',
}
KNOWN_VERIFIED_VOICES = {
    'BV421_vivn_streaming',
    'vi_female_huong',
    'BV074_streaming_dsp',
    'BV074_streaming',
    'BV075_streaming_vibrato_dsp',
    'BV562_streaming',
}


class CapCutDiagnosticError(RuntimeError):
    def __init__(self, message, **details):
        super().__init__(message)
        self.details = {key: value for key, value in details.items() if value is not None}


def voice_metadata(voice):
    unsupported_reason = KNOWN_UNSUPPORTED_VOICES.get(voice.voice_type)
    if unsupported_reason:
        return {
            'provider': 'external-neural',
            'capcut_supported': False,
            'verified': False,
            'availability': 'unsupported',
            'reason': unsupported_reason,
        }
    if voice.voice_type in KNOWN_VERIFIED_VOICES:
        return {
            'provider': 'capcut',
            'capcut_supported': True,
            'verified': True,
            'availability': 'verified',
        }
    provider = 'external-neural' if voice.voice_type.lower().endswith('neural') else 'unknown'
    return {
        'provider': provider,
        'capcut_supported': None,
        'verified': False,
        'availability': 'unverified',
    }


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
        raise CapCutDiagnosticError(
            'CapCut API request bị từ chối',
            provider='capcut',
            api_status=str(response.get('ret')),
            api_message=str(response.get('errmsg', 'Request rejected'))[:250],
        )
    return response


def task_failure(result, voice):
    code = result.get('err_code')
    api_message = result.get('err_msg') or result.get('message')
    node = result.get('failed_node_key')
    status = result.get('status')
    if str(code) == '40402004' or api_message == 'TTSInvalidSpeaker':
        raise CapCutDiagnosticError(
            'Giọng không được CapCut hỗ trợ',
            code=str(code) if code is not None else None,
            api_message=api_message,
            failed_node=node,
            task_status=status,
            voice=voice.voice_type,
            provider='capcut',
            retryable=False,
        )
    raise CapCutDiagnosticError(
        'CapCut synthesis failed',
        code=str(code) if code is not None else None,
        api_message=api_message,
        failed_node=node,
        task_status=status,
        voice=voice.voice_type,
        provider='capcut',
        retryable=False,
    )


def find_voice(voices, voice_id):
    voice = next((item for item in voices if item.voice_type == voice_id), None)
    if not voice:
        raise CapCutDiagnosticError('Voice không tồn tại trong catalog CapCut', voice=voice_id)
    metadata = voice_metadata(voice)
    if metadata['capcut_supported'] is False:
        raise CapCutDiagnosticError(
            'Giọng không được CapCut hỗ trợ',
            code='40402004',
            api_message='TTSInvalidSpeaker',
            voice=voice.voice_type,
            provider=metadata['provider'],
            retryable=False,
        )
    return voice, metadata


def synthesize(client, text, voice):
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
            return {'success': True, 'filename': f'capcut/{target.name}', 'cache_hit': True}
    task = checked(client.create_tts_task(text, voice.voice_type, voice.resource_id))['data']['tasks'][0]
    deadline = time.monotonic() + 120
    result = None
    while time.monotonic() < deadline:
        tasks = checked(client.query_tts_task(task['id'], task['token']))['data']['tasks']
        result = next((item for item in tasks if item.get('id') == task['id']), None)
        if result and result.get('status') in ('success', 'succeed'):
            break
        if result and result.get('status') in ('failed', 'fail', 'cancelled'):
            task_failure(result, voice)
        time.sleep(1)
    else:
        raise CapCutDiagnosticError(
            'CapCut task did not finish within 120 seconds',
            voice=voice.voice_type,
            task_status=result.get('status') if result else None,
            retryable=True,
        )
    payload = result['payload']
    payload = json.loads(payload) if isinstance(payload, str) else payload
    clips = payload.get('audio_subtitles', [])
    if len(clips) != 1 or clips[0].get('code', 0) != 0 or clips[0].get('invalid_input'):
        raise CapCutDiagnosticError('CapCut trả về audio không hợp lệ', voice=voice.voice_type, retryable=False)
    url = clips[0].get('speech_url', '')
    host = urlparse(url).hostname or ''
    if urlparse(url).scheme != 'https' or not any(host.endswith('.' + domain) for domain in ('tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com')):
        raise CapCutDiagnosticError('CapCut trả về URL audio không hợp lệ', voice=voice.voice_type, retryable=False)
    with client.session.get(url, timeout=30, stream=True, allow_redirects=False) as response:
        if response.status_code != 200:
            raise CapCutDiagnosticError(
                f'CapCut audio download HTTP {response.status_code}',
                voice=voice.voice_type,
                http_status=response.status_code,
                retryable=response.status_code >= 500,
            )
        with tempfile.TemporaryDirectory(dir=OUTPUT) as directory:
            source = Path(directory) / 'raw.mp3'
            size = 0
            with source.open('wb') as output:
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 50 * 1024 * 1024:
                        raise CapCutDiagnosticError('CapCut audio exceeds size limit', voice=voice.voice_type)
                    output.write(chunk)
            wav = Path(directory) / 'audio.wav'
            subprocess.run([os.getenv('FFMPEG_PATH', 'ffmpeg'), '-v', 'error', '-y', '-i', str(source),
                            '-vn', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True, capture_output=True, timeout=60)
            if wav.stat().st_size < 128:
                raise CapCutDiagnosticError('CapCut returned empty audio', voice=voice.voice_type)
            digest = hashlib.sha256(wav.read_bytes()).hexdigest()
            wav.replace(target)
    temporary = metadata.with_suffix('.tmp')
    temporary.write_text(json.dumps({'hash': digest, 'voice': voice.voice_type, 'revision': REVISION}), encoding='utf-8')
    temporary.replace(metadata)
    return {'success': True, 'filename': f'capcut/{target.name}', 'cache_hit': False}


def run(data):
    client = CapCutClient(session=RetryingSession(), device=os.getenv('CAPCUT_DEVICE_CONFIG') or None)
    voices = client.list_voices(catalog_path=CATALOG)
    action = data.get('action')
    if action == 'voices':
        include_unverified = bool(data.get('include_unverified'))
        items = []
        for item in voices:
            metadata = voice_metadata(item)
            if metadata['capcut_supported'] is False and not include_unverified:
                continue
            items.append({
                'id': item.voice_type,
                'name': item.display_name,
                'language': item.lang or item.lan,
                **metadata,
            })
        return {'voices': items, 'catalog_revision': REVISION, 'filtered_count': len(voices) - len(items)}
    voice, metadata = find_voice(voices, data.get('voice'))
    if action == 'verify':
        text = str(data.get('text') or DEFAULT_VERIFY_TEXT).strip()
        if not text or len(text) > 500:
            raise ValueError('Nội dung kiểm tra giọng phải dài 1–500 ký tự')
        result = synthesize(client, text, voice)
        return {
            **result,
            'verified': True,
            'voice': voice.voice_type,
            'provider': metadata['provider'],
            'catalog_revision': REVISION,
        }
    if action != 'synthesize':
        raise ValueError('CapCut action không hợp lệ')
    text = str(data.get('text') or '').strip()
    if not text or len(text) > 5000:
        raise ValueError('Văn bản phải dài 1–5000 ký tự')
    result = synthesize(client, text, voice)
    return {**result, 'voice': voice.voice_type, 'provider': metadata['provider']}


if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        message = str(error) if isinstance(error, (ValueError, RuntimeError, TimeoutError)) else type(error).__name__
        payload = {'error': message[:400]}
        if isinstance(error, CapCutDiagnosticError):
            payload.update(error.details)
        print(json.dumps(payload, ensure_ascii=False))
        sys.exit(1)
