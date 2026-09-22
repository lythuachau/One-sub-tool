from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
import urllib.request
from pathlib import Path
from typing import Any

import soundfile as sf


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_audio(path: Path) -> dict[str, Any]:
    info = sf.info(str(path))
    data, _ = sf.read(str(path), always_2d=True)
    peak = float(abs(data).max()) if data.size else 0.0
    rms = float((data**2).mean() ** 0.5) if data.size else 0.0
    return {
        "path": str(path),
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "frames": info.frames,
        "duration_seconds": round(info.duration, 6),
        "peak": round(peak, 6),
        "rms": round(rms, 6),
        "sha256": sha256(path),
    }


def run_direct(tts: Any, text: str, reference_audio: Path, reference_text: str, output: Path) -> float:
    started = time.perf_counter()
    audio = tts.infer(
        text=text,
        ref_audio=str(reference_audio),
        ref_text=reference_text or None,
        speed=1.0,
    )
    tts.save(audio, str(output))
    return time.perf_counter() - started


def run_osg(
    url: str,
    text: str,
    reference_audio: Path,
    reference_text: str,
) -> tuple[float, Path, list[dict[str, Any]]]:
    payload = {
        "reference_audio": str(reference_audio.resolve()),
        "reference_text": reference_text,
        "subtitles": [{"id": "benchmark-001", "text": text, "start": 0, "end": 10}],
        "settings": {"speechRate": 1.0},
    }
    request = urllib.request.Request(
        f"{url.rstrip('/')}/api/narration/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    started = time.perf_counter()
    events: list[dict[str, Any]] = []
    with urllib.request.urlopen(request, timeout=900) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()
            if not line.startswith("data: "):
                continue
            events.append(json.loads(line[6:]))
    elapsed = time.perf_counter() - started
    results = [event.get("result") for event in events if event.get("type") == "result" and event.get("result")]
    if not results:
        errors = [event.get("error") for event in events if event.get("type") == "error"]
        raise RuntimeError(f"OSG did not return audio: {errors}")
    source_path = Path(results[0]["filepath"])
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    return elapsed, source_path, events


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare direct VieNeu-TTS with the OSG VieNeu adapter.")
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--reference-text", default="")
    parser.add_argument("--text", required=True)
    parser.add_argument("--osg-url", default="http://127.0.0.1:3035")
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark_outputs/vieneu"))
    parser.add_argument("--source-commit", default="e41fdeaa280610e946466736b60cf141e45f3cab")
    args = parser.parse_args()

    if not args.reference.is_file():
        raise FileNotFoundError(args.reference)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    from vieneu import Vieneu

    init_started = time.perf_counter()
    tts = Vieneu()
    direct_init_seconds = time.perf_counter() - init_started
    direct_warmup_started = time.perf_counter()
    run_direct(
        tts,
        args.text,
        args.reference,
        args.reference_text,
        args.output_dir / "direct_vieneu_warmup.wav",
    )
    direct_warmup_seconds = time.perf_counter() - direct_warmup_started
    direct_path = args.output_dir / "direct_vieneu.wav"
    direct_seconds = run_direct(tts, args.text, args.reference, args.reference_text, direct_path)

    warmup_started = time.perf_counter()
    run_osg(args.osg_url, args.text, args.reference, args.reference_text)
    osg_warmup_seconds = time.perf_counter() - warmup_started
    osg_seconds, osg_source, events = run_osg(
        args.osg_url,
        args.text,
        args.reference,
        args.reference_text,
    )
    osg_path = args.output_dir / "osg_vieneu.wav"
    shutil.copy2(osg_source, osg_path)

    report = {
        "engine": "VieNeu-TTS",
        "source_commit": args.source_commit,
        "reference_audio": str(args.reference.resolve()),
        "reference_text": args.reference_text,
        "text": args.text,
        "same_voice_input": True,
        "direct": {
            "initialization_seconds": round(direct_init_seconds, 6),
            "warmup_seconds": round(direct_warmup_seconds, 6),
            "elapsed_seconds": round(direct_seconds, 6),
            **inspect_audio(direct_path),
        },
        "osg": {
            "warmup_seconds": round(osg_warmup_seconds, 6),
            "elapsed_seconds": round(osg_seconds, 6),
            **inspect_audio(osg_path),
        },
        "speed_ratio_osg_over_direct": round(osg_seconds / direct_seconds, 6) if direct_seconds else None,
        "events": events,
    }
    report_path = args.output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
