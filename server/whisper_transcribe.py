import argparse
import json
import os
import sys


def choose_device(requested):
    if requested != "auto":
        return requested
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"


def normalize_language(value):
    if not value or value.lower() == "auto":
        return None
    language = value.strip().lower().replace("_", "-")
    aliases = {
        "zh-cn": "zh",
        "zh-tw": "zh",
        "ja-jp": "ja",
        "ko-kr": "ko",
        "en-us": "en",
        "en-gb": "en",
        "vi-vn": "vi",
    }
    return aliases.get(language, language.split("-", 1)[0])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="medium")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--language", default="auto")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    device = choose_device(args.device)
    compute_type = "float16" if device == "cuda" else "int8"
    model_name = args.model
    model_dir = os.environ.get("WHISPER_MODEL_DIR", "").strip()
    if model_dir and os.path.isdir(model_dir):
        model_name = model_dir

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except RuntimeError:
        if args.device != "auto" or device != "cuda":
            raise
        device = "cpu"
        model = WhisperModel(model_name, device=device, compute_type="int8")

    language = normalize_language(args.language)
    segments_iter, info = model.transcribe(
        args.input,
        language=language,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 250},
        beam_size=5,
        word_timestamps=True,
    )
    segments = []
    for segment in segments_iter:
        text = (segment.text or "").strip()
        if not text:
            continue
        segments.append({
            "start": float(segment.start or 0.0),
            "end": float(segment.end or 0.0),
            "text": text,
        })

    result = {
        "success": True,
        "device": device,
        "model": args.model,
        "detected": getattr(info, "language", None) or "unknown",
        "duration": max((item["end"] for item in segments), default=0.0),
        "segments": segments,
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
