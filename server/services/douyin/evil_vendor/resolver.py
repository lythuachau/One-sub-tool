from __future__ import annotations

import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from abogus import ABogus, browser_info_from_screen
from websign import VERIFY_FP_COOKIE, VERIFY_FP_PARAMS, pick_uifid, sign as sign_web


DOUYIN_DETAIL_ENDPOINT = "https://www.douyin.com/aweme/v1/web/aweme/detail/"
DOUYIN_MEDIA_DOMAINS = (
    "douyinvod.com",
    "zjcdn.com",
    "douyinpic.com",
    "douyinstatic.com",
    "iesdouyin.com",
    "douyin.com",
    "bytecdn.cn",
    "byteimg.com",
    "pstatp.com",
    "ibyteimg.com",
    "amemv.com",
    "ixigua.com",
    "bytedance.com",
)
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class ResolverError(RuntimeError):
    pass


def read_request() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ResolverError("resolver input is empty")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ResolverError("resolver input must be an object")
    return value


def extract_video_id(value: str) -> str | None:
    match = re.search(r"/(?:video|share/video)/(\d{8,25})(?:/|$|[?#])", value)
    if match:
        return match.group(1)
    match = re.search(r"(?:modal_id|aweme_id)=(\d{8,25})", value)
    return match.group(1) if match else None


def random_ms_token(rng: random.Random) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-"
    return "".join(rng.choice(alphabet) for _ in range(126)) + "=="


def normalise_cookies(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items() if item is not None}


def build_params(
    video_id: str, user_agent: str, cookies: dict[str, str]
) -> tuple[str, dict[str, str], dict[str, str]]:
    params: dict[str, str] = {
        "device_platform": "webapp",
        "aid": "6383",
        "channel": "channel_pc_web",
        "pc_client_type": "1",
        "version_code": "290100",
        "version_name": "29.1.0",
        "cookie_enabled": "true",
        "screen_width": "1920",
        "screen_height": "1080",
        "browser_language": "zh-CN",
        "browser_platform": "Win32",
        "browser_name": "Chrome",
        "browser_version": "130.0.0.0",
        "browser_online": "true",
        "engine_name": "Blink",
        "engine_version": "130.0.0.0",
        "os_name": "Windows",
        "os_version": "10",
        "cpu_core_num": "12",
        "device_memory": "8",
        "platform": "PC",
        "downlink": "10",
        "effective_type": "4g",
        "round_trip_time": "0",
        "update_version_code": "170400",
        "aweme_id": video_id,
        "msToken": cookies.get("msToken") or random_ms_token(random.Random()),
    }
    query = urllib.parse.urlencode(params)
    params["a_bogus"] = ABogus(
        user_agent,
        browser_info=browser_info_from_screen(1920, 1080, "Win32"),
        rng=random.Random(),
    ).get_value(query)
    web_headers: dict[str, str] = {}
    if pick_uifid(cookies):
        pairs = list(params.items())
        verify_fp = cookies.get(VERIFY_FP_COOKIE)
        if verify_fp:
            pairs.extend((name, verify_fp) for name in VERIFY_FP_PARAMS)
        query, _, web_headers = sign_web(pairs, pick_uifid(cookies) or "")
    return query, params, web_headers


def request_detail(video_id: str, user_agent: str, cookies: dict[str, str]) -> dict[str, Any]:
    query, _, web_headers = build_params(video_id, user_agent, cookies)
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.douyin.com/",
        "Origin": "https://www.douyin.com",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
    }
    headers.update(web_headers)
    if cookies:
        headers["Cookie"] = "; ".join(f"{key}={value}" for key, value in cookies.items())
    request = urllib.request.Request(f"{DOUYIN_DETAIL_ENDPOINT}?{query}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            status = response.status
    except urllib.error.HTTPError as error:
        detail = error.read(512).decode("utf-8", "replace")
        raise ResolverError(f"Douyin detail HTTP {error.code}: {detail[:180]}") from error
    except urllib.error.URLError as error:
        raise ResolverError(f"Douyin detail request failed: {error.reason}") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise ResolverError("Douyin detail response is too large")
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ResolverError(f"Douyin detail response is not JSON (HTTP {status})") from error
    if not isinstance(payload, dict):
        raise ResolverError("Douyin detail response has an invalid shape")
    return payload


def media_urls(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    values = node.get("url_list")
    if not isinstance(values, list):
        return []
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value.startswith(("http://", "https://")):
            continue
        host = (urllib.parse.urlsplit(value).hostname or "").lower()
        if any(host == domain or host.endswith(f".{domain}") for domain in DOUYIN_MEDIA_DOMAINS):
            if value not in result:
                result.append(value)
    return result


def resolve_media(payload: dict[str, Any], requested_id: str) -> dict[str, Any]:
    detail = payload.get("aweme_detail")
    if not isinstance(detail, dict):
        status = payload.get("status_code")
        raise ResolverError(f"Douyin metadata unavailable (status_code={status!r})")
    actual_id = str(detail.get("aweme_id") or detail.get("aweme_id_str") or "")
    if actual_id != requested_id:
        raise ResolverError(f"Douyin video identity mismatch: requested {requested_id}, got {actual_id or 'none'}")
    status = detail.get("status") if isinstance(detail.get("status"), dict) else {}
    if status.get("is_delete") or status.get("private_status") not in (None, 0, "0"):
        raise ResolverError("Douyin video is private or deleted")
    video = detail.get("video") if isinstance(detail.get("video"), dict) else {}
    streams: list[dict[str, Any]] = []
    main = media_urls(video.get("play_addr"))
    if main:
        streams.append({"url": main[0], "urls": main, "watermark": False})
    for bitrate in video.get("bit_rate") or []:
        if not isinstance(bitrate, dict):
            continue
        urls = media_urls(bitrate.get("play_addr"))
        if urls:
            streams.append({
                "url": urls[0],
                "urls": urls,
                "watermark": False,
                "bitrate": bitrate.get("bit_rate"),
                "format": bitrate.get("format"),
            })
    if not streams:
        raise ResolverError("Douyin metadata has no approved clean video stream")
    return {
        "videoId": requested_id,
        "canonicalUrl": f"https://www.douyin.com/video/{requested_id}",
        "title": str(detail.get("desc") or ""),
        "author": str((detail.get("author") or {}).get("nickname") or "") if isinstance(detail.get("author"), dict) else "",
        "streams": streams,
        "durationMs": (video.get("duration") if isinstance(video, dict) else None),
        "resolvedAt": int(time.time() * 1000),
    }


def main() -> None:
    request = read_request()
    source = str(request.get("url") or "")
    video_id = str(request.get("videoId") or extract_video_id(source) or "")
    if not video_id.isdigit():
        raise ResolverError("Douyin resolver requires a numeric videoId")
    cookies = normalise_cookies(request.get("cookies"))
    user_agent = str(request.get("userAgent") or DEFAULT_USER_AGENT)
    payload = request_detail(video_id, user_agent, cookies)
    print(json.dumps(resolve_media(payload, video_id), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
