import argparse
import json
import re
import sys
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.extractor.bilibili import BiliBiliIE


def get_candidate_urls(item):
    primary_url = item.get('baseUrl') or item.get('base_url') or item.get('url')
    backup_urls = item.get('backupUrl') or item.get('backup_url') or []
    if isinstance(backup_urls, str):
        backup_urls = [backup_urls]
    return [url for url in [primary_url, *backup_urls] if isinstance(url, str) and url]


def get_format_id(url):
    match = re.search(r'-(\d+)\.m4s(?:\?|$)', url or '')
    return match.group(1) if match else None


def remove_attempt_artifacts(output_path):
    output = Path(output_path)
    prefix = output.stem
    for artifact in output.parent.glob(f'{prefix}*'):
        if artifact.is_file():
            artifact.unlink(missing_ok=True)


def apply_shared_args(options, shared_args):
    index = 0
    while index < len(shared_args):
        argument = shared_args[index]
        if index + 1 >= len(shared_args):
            break
        value = shared_args[index + 1]
        if argument == '--plugin-dirs':
            options['plugin_dirs'] = [value]
        elif argument == '--cookies':
            options['cookiefile'] = value
        elif argument == '--cookies-from-browser':
            options['cookiesfrombrowser'] = (value,)
        index += 2


def create_options(args):
    options = {
        'format': args.format,
        'outtmpl': args.output,
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'quiet': False,
        'no_warnings': True,
        'progress_with_newline': True,
        'http_chunk_size': 8 * 1024 * 1024,
        'retries': 3,
        'fragment_retries': 3,
        'file_access_retries': 3,
        'socket_timeout': 30,
        'overwrites': True,
        'nocheckcertificate': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }
    apply_shared_args(options, json.loads(args.shared_args))
    return options


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--format', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--shared-args', default='[]')
    args = parser.parse_args()
    original_extract_formats = BiliBiliIE.extract_formats
    state = {'mirror_index': 1, 'mirror_count': 1}

    def extract_formats_with_mirror(extractor, play_info):
        formats = original_extract_formats(extractor, play_info)
        dash = play_info.get('dash') or {}
        raw_formats = (dash.get('video') or []) + (dash.get('audio') or [])
        candidates_by_id = {}
        for raw_format in raw_formats:
            candidates = get_candidate_urls(raw_format)
            format_id = get_format_id(candidates[0] if candidates else '')
            if format_id:
                candidates_by_id[format_id] = candidates
                state['mirror_count'] = max(state['mirror_count'], len(candidates))

        for media_format in formats:
            candidates = candidates_by_id.get(str(media_format.get('format_id') or ''))
            if candidates and state['mirror_index'] < len(candidates):
                media_format['url'] = candidates[state['mirror_index']]
        return formats

    BiliBiliIE.extract_formats = extract_formats_with_mirror
    options = create_options(args)
    mirror_order = [1, 0]
    failure_messages = []

    try:
        for mirror_index in mirror_order:
            state['mirror_index'] = mirror_index
            state['mirror_count'] = 1
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(args.url, download=False)
                available_mirrors = state['mirror_count']
                if mirror_index >= available_mirrors:
                    continue
                print(f'[BILI-MIRROR] Download attempt using mirror {mirror_index + 1}/{available_mirrors}', flush=True)
                try:
                    ydl.process_ie_result(info, download=True)
                    return 0
                except Exception as error:
                    message = re.sub(r'https?://\S+', '[media URL]', str(error))
                    failure_messages.append(f'mirror {mirror_index + 1}: {message}')
                    print(f'[BILI-MIRROR] Attempt failed: {message}', file=sys.stderr, flush=True)
                    remove_attempt_artifacts(args.output)

        for mirror_index in range(2, state['mirror_count']):
            state['mirror_index'] = mirror_index
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(args.url, download=False)
                if mirror_index >= state['mirror_count']:
                    continue
                print(f'[BILI-MIRROR] Download attempt using mirror {mirror_index + 1}/{state["mirror_count"]}', flush=True)
                try:
                    ydl.process_ie_result(info, download=True)
                    return 0
                except Exception as error:
                    message = re.sub(r'https?://\S+', '[media URL]', str(error))
                    failure_messages.append(f'mirror {mirror_index + 1}: {message}')
                    print(f'[BILI-MIRROR] Attempt failed: {message}', file=sys.stderr, flush=True)
                    remove_attempt_artifacts(args.output)
    finally:
        BiliBiliIE.extract_formats = original_extract_formats

    print('All Bilibili CDN mirror attempts failed: ' + ' | '.join(failure_messages), file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
