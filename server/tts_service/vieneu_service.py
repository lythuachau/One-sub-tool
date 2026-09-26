from __future__ import annotations

import json
import logging
import importlib.resources
import os
import threading
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

from runtime import (
    OUTPUT_DIR,
    audio_response,
    clean_text,
    device_info,
    package_available,
    output_path,
    resolve_reference_audio,
    subtitle_id,
    subtitle_text,
    write_wav,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("osg-vieneu")
app = Flask(__name__)
CORS(app)
model_lock = threading.Lock()
model: Any = None
model_error: str | None = None
model_loading = False


def _preset_voice_metadata() -> dict[str, Any]:
    try:
        asset = importlib.resources.files("vieneu").joinpath("assets", "voices_v3_turbo.json")
        data = json.loads(asset.read_text(encoding="utf-8"))
        presets = data.get("presets", {})
        return {
            "default_voice": data.get("default_voice"),
            "voices": [
                {
                    "id": name,
                    "name": name,
                    "description": value.get("description", ""),
                    "gender": value.get("gender"),
                }
                for name, value in presets.items()
            ],
        }
    except Exception as exc:
        logger.warning("Could not load VieNeu preset voice metadata: %s", exc)
        return {"default_voice": None, "voices": [], "error": str(exc)}


def _load_model() -> Any:
    global model, model_error, model_loading
    if model is not None:
        return model
    with model_lock:
        if model is not None:
            return model
        model_loading = True
        logger.info("Loading VieNeu-TTS model")
        try:
            from vieneu import Vieneu

            backend = clean_text(__import__("os").getenv("VIENEU_BACKEND", "onnx"))
            try:
                model = Vieneu(backend=backend) if backend else Vieneu()
            except TypeError:
                model = Vieneu()
            model_error = None
            return model
        except Exception as exc:
            model_error = str(exc)
            raise
        finally:
            model_loading = False
            logger.info("VieNeu-TTS model state: %s", "ready" if model is not None else "error")


def _status() -> dict[str, Any]:
    available, import_error = package_available("vieneu")
    state = "ready" if model is not None else ("loading" if model_loading else ("error" if model_error else "not_loaded"))
    return {
        "available": available,
        "ready": model is not None,
        "loading": model_loading,
        "state": state,
        "engine": "vieneu",
        "device": device_info(),
        "models": {"tts": model is not None},
        "initialization_error": model_error or import_error,
    }


def _model_catalog() -> dict[str, Any]:
    available, import_error = package_available("vieneu")
    model_id = os.getenv("VIENEU_MODEL", "vieneu")
    model_info = {
        "id": model_id,
        "name": "VieNeu-TTS",
        "engine": "vieneu",
        "provider": "local",
        "language": "vi",
        "languages": ["vi"],
        "available": available,
        "ready": model is not None,
        "loading": model_loading,
        "state": "ready" if model is not None else ("loading" if model_loading else ("error" if model_error else "not_loaded")),
        "installed": available,
        "model_path": None,
        "initialization_error": model_error or import_error,
    }
    return {
        "models": [model_info] if available else [],
        "active_model": model_id if available else None,
        "cached_models": [],
    }


def _event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _infer(tts: Any, text: str, reference_audio: str | None, reference_text: str, settings: dict[str, Any]) -> Any:
    speed = settings.get("speechRate")
    kwargs = {"text": text}
    voice = settings.get("voice")
    if voice:
        kwargs["voice"] = clean_text(voice)
    if reference_audio:
        kwargs["ref_audio"] = reference_audio
    if reference_text:
        kwargs["ref_text"] = reference_text
    if speed:
        kwargs["speed"] = float(speed)
    aliases = {
        "temperature": "temperature",
        "topK": "top_k",
        "top_k": "top_k",
        "topP": "top_p",
        "top_p": "top_p",
        "maxNewFrames": "max_new_frames",
        "max_new_frames": "max_new_frames",
        "repetitionPenalty": "repetition_penalty",
        "repetition_penalty": "repetition_penalty",
        "maxChars": "max_chars",
        "max_chars": "max_chars",
        "silenceP": "silence_p",
        "silence_p": "silence_p",
        "crossfadeP": "crossfade_p",
        "crossfade_p": "crossfade_p",
        "applyWatermark": "apply_watermark",
        "apply_watermark": "apply_watermark",
    }
    for source, target in aliases.items():
        if source in settings and settings[source] is not None:
            kwargs[target] = settings[source]
    try:
        return tts.infer(**kwargs)
    except TypeError:
        kwargs.pop("speed", None)
        try:
            return tts.infer(**kwargs)
        except TypeError:
            kwargs.pop("ref_text", None)
            return tts.infer(**kwargs)


@app.get("/api/narration/status")
def status():
    return jsonify(_status())


@app.get("/api/narration/models")
def models():
    return jsonify(_model_catalog())


@app.get("/api/narration/models/active")
def active_model():
    catalog = _model_catalog()
    return jsonify({"active_model": catalog["active_model"]})


@app.get("/api/narration/voices")
def voices():
    metadata = _preset_voice_metadata()
    return jsonify({"engine": "vieneu", **metadata})


@app.get("/health")
def health():
    return jsonify(_status())


@app.post("/api/narration/wake-up")
def wake_up():
    try:
        _load_model()
        return jsonify({"status": "ok", "message": "VieNeu-TTS is ready", **_status()})
    except Exception as exc:
        return jsonify({"status": "error", "error": f"VieNeu-TTS initialization failed: {exc}", **_status()}), 503


@app.post("/api/narration/preview")
def preview():
    payload = request.get_json(silent=True) or {}
    text = clean_text(payload.get("text"))
    if not text:
        return jsonify({"error": "Preview text is required"}), 400

    settings = payload.get("settings") or {}
    reference_audio = resolve_reference_audio(payload.get("reference_audio"))
    reference_text = clean_text(payload.get("reference_text"))

    try:
        tts = _load_model()
        with model_lock:
            generated = _infer(tts, text, reference_audio, reference_text, settings)
        data, sample_rate = audio_response(generated, 48000)
        response = app.response_class(data, mimetype="audio/wav")
        response.headers["X-Sample-Rate"] = str(sample_rate)
        return response
    except Exception as exc:
        logger.exception("VieNeu preview failed")
        return jsonify({"error": str(exc), "engine": "vieneu"}), 503


@app.route("/api/narration/generate", methods=["HEAD"])
def generate_head():
    return Response(status=200, headers={"Content-Type": "text/event-stream"})


@app.post("/api/narration/generate")
def generate():
    payload = request.get_json(silent=True) or {}
    subtitles = payload.get("subtitles") or []
    settings = payload.get("settings") or {}
    reference_audio = resolve_reference_audio(payload.get("reference_audio"))
    reference_text = clean_text(payload.get("reference_text"))

    def stream():
        try:
            tts = _load_model()
        except Exception as exc:
            yield _event({"type": "error", "error": f"VieNeu-TTS initialization failed: {exc}"})
            yield _event({"type": "complete", "results": [], "total": 0})
            return
        results: list[dict[str, Any]] = []
        generation_id = settings.get("generation_id")
        with model_lock:
            for index, subtitle in enumerate(subtitles):
                segment_id = subtitle_id(subtitle, index)
                text = subtitle_text(subtitle)
                if not text:
                    yield _event({"type": "error", "subtitle_id": segment_id, "error": "Subtitle text is empty"})
                    continue
                try:
                    generated = _infer(tts, text, reference_audio, reference_text, settings)
                    destination = output_path(segment_id, generation_id)
                    sample_rate = write_wav(generated, destination, 48000)
                    result = {
                        "subtitle_id": segment_id,
                        "text": text,
                        "filename": str(destination.relative_to(OUTPUT_DIR)).replace(os.sep, "/"),
                        "filepath": str(destination),
                        "sample_rate": sample_rate,
                        "start": subtitle.get("start", 0),
                        "end": subtitle.get("end", 0),
                        "success": True,
                        "method": "vieneu",
                    }
                    results.append(result)
                    yield _event({
                        "type": "result",
                        "result": result,
                        "progress": index + 1,
                        "total": len(subtitles),
                    })
                except Exception as exc:
                    logger.exception("VieNeu generation failed for %s", segment_id)
                    yield _event({
                        "type": "error",
                        "subtitle_id": segment_id,
                        "error": str(exc),
                        "progress": index + 1,
                        "total": len(subtitles),
                    })
        yield _event({"type": "complete", "results": results, "total": len(results)})

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


@app.get("/")
def index():
    return jsonify({"status": "ok", **_status()})


if __name__ == "__main__":
    import os

    app.run(host="0.0.0.0", port=int(os.getenv("NARRATION_PORT", "3035")), threaded=True)
