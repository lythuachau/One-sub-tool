from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

from runtime import audio_response, device_info, package_available, temporary_reference

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("osg-omnivoice")
app = Flask(__name__)
CORS(app)
model_lock = threading.Lock()
model: Any = None
model_error: str | None = None
model_loading = False

_VOICE_DESIGN_FALLBACK = {
    "gender": ["male", "female"],
    "age": ["child", "teenager", "young adult", "middle-aged", "elderly"],
    "pitch": ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"],
    "style": ["whisper"],
    "accent": [
        "american accent", "british accent", "australian accent", "chinese accent",
        "canadian accent", "indian accent", "korean accent", "portuguese accent",
        "russian accent", "japanese accent",
    ],
    "dialect": [
        "河南话", "陕西话", "四川话", "贵州话", "云南话", "桂林话", "济南话",
        "石家庄话", "甘肃话", "宁夏话", "青岛话", "东北话",
    ],
}


def _voice_design_options() -> dict[str, list[str]]:
    try:
        from omnivoice.utils.voice_design import _INSTRUCT_CATEGORIES

        groups = {
            "gender": list(_INSTRUCT_CATEGORIES[0].keys()),
            "age": list(_INSTRUCT_CATEGORIES[1].keys()),
            "pitch": list(_INSTRUCT_CATEGORIES[2].keys()),
            "style": list(_INSTRUCT_CATEGORIES[3].keys()),
            "accent": sorted(_INSTRUCT_CATEGORIES[4]),
            "dialect": sorted(_INSTRUCT_CATEGORIES[5]),
        }
        return groups
    except Exception as exc:
        logger.warning("Could not load OmniVoice design metadata: %s", exc)
        return _VOICE_DESIGN_FALLBACK


def _load_model() -> Any:
    global model, model_error, model_loading
    if model is not None:
        return model
    with model_lock:
        if model is not None:
            return model
        model_loading = True
        logger.info("Loading OmniVoice model")
        try:
            import torch
            from omnivoice import OmniVoice

            info = device_info()
            if info["device"] == "unavailable":
                raise RuntimeError("CUDA was requested but is not available")
            device = "cuda:0" if info["device"] == "cuda" else "cpu"
            dtype = torch.float16 if device.startswith("cuda") else torch.float32
            model_name = os.getenv("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
            model = OmniVoice.from_pretrained(model_name, device_map=device, dtype=dtype)
            model_error = None
            return model
        except Exception as exc:
            model_error = str(exc)
            raise
        finally:
            model_loading = False
            logger.info("OmniVoice model state: %s", "ready" if model is not None else "error")


def _status() -> dict[str, Any]:
    available, import_error = package_available("omnivoice")
    state = "ready" if model is not None else ("loading" if model_loading else ("error" if model_error else "not_loaded"))
    return {
        "status": "ok" if available else "unavailable",
        "available": available,
        "ready": model is not None,
        "loading": model_loading,
        "engine": "omnivoice",
        "model_name": os.getenv("OMNIVOICE_MODEL", "k2-fsa/OmniVoice"),
        "model_state": state,
        "device": device_info(),
        "models_loaded": {"tts": model is not None},
        "initialization_error": model_error or import_error,
    }


def _model_catalog() -> dict[str, Any]:
    available, import_error = package_available("omnivoice")
    model_id = os.getenv("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
    state = "ready" if model is not None else ("loading" if model_loading else ("error" if model_error else "not_loaded"))
    model_info = {
        "id": model_id,
        "name": "OmniVoice",
        "engine": "omnivoice",
        "provider": "local",
        "language": "multi",
        "languages": ["vi", "en", "zh"],
        "available": available,
        "ready": model is not None,
        "loading": model_loading,
        "state": state,
        "installed": available,
        "model_path": None,
        "initialization_error": model_error or import_error,
    }
    return {
        "models": [model_info] if available else [],
        "active_model": model_id if available else None,
        "cached_models": [],
    }


@app.get("/health")
def health():
    return jsonify(_status())


@app.get("/api/narration/status")
def narration_status():
    return jsonify(_status())


@app.get("/api/narration/models")
def models():
    return jsonify(_model_catalog())


@app.get("/api/narration/models/active")
def active_model():
    catalog = _model_catalog()
    return jsonify({"active_model": catalog["active_model"]})


@app.post("/wake-up")
def wake_up():
    try:
        _load_model()
        return jsonify({"status": "ok", "message": "OmniVoice is ready", **_status()})
    except Exception as exc:
        return jsonify({"status": "error", "error": f"OmniVoice initialization failed: {exc}", **_status()}), 503


@app.get("/voice-design/options")
def voice_design_options():
    return jsonify({"engine": "omnivoice", "groups": _voice_design_options()})


def _generate(model_instance: Any, text: str, ref_audio: str | None, ref_text: str, form: Any) -> Any:
    kwargs = {"text": text}
    voice_mode = str(form.get("voice_mode") or "reference").strip().lower()
    if voice_mode == "reference":
        kwargs["ref_audio"] = ref_audio
        if ref_text:
            kwargs["ref_text"] = ref_text
    elif voice_mode == "design":
        kwargs["instruct"] = str(form.get("instruct") or "").strip()
    if form.get("language"):
        kwargs["language"] = form.get("language")
    if form.get("speed"):
        kwargs["speed"] = float(form.get("speed"))
    if form.get("num_step"):
        kwargs["num_step"] = int(form.get("num_step"))
    if form.get("guidance_scale"):
        kwargs["guidance_scale"] = float(form.get("guidance_scale"))
    if form.get("cfg_weight"):
        kwargs["guidance_scale"] = float(form.get("cfg_weight"))
    try:
        return model_instance.generate(**kwargs)
    except TypeError:
        fallback = {"text": text}
        if voice_mode == "reference":
            fallback["ref_audio"] = ref_audio
            fallback["ref_text"] = ref_text or None
        elif voice_mode == "design":
            fallback["instruct"] = str(form.get("instruct") or "").strip()
        return model_instance.generate(**fallback)


@app.post("/tts/generate")
def generate():
    text = str(request.form.get("text") or "").strip()
    voice_file = request.files.get("voice_file")
    voice_mode = str(request.form.get("voice_mode") or "reference").strip().lower()
    instruct = str(request.form.get("instruct") or "").strip()
    if not text:
        return jsonify({"error": "Text is required"}), 400
    if voice_mode not in {"reference", "design", "auto"}:
        return jsonify({"error": "Unsupported OmniVoice voice mode"}), 400
    if voice_mode == "reference" and voice_file is None:
        return jsonify({"error": "Reference audio is required for OmniVoice reference mode"}), 400
    if voice_mode == "design" and not instruct:
        return jsonify({"error": "Voice design instructions are required for OmniVoice design mode"}), 400

    temporary_path: Path | None = None
    if voice_file is not None:
        temporary = temporary_reference(Path(voice_file.filename or "reference.wav").suffix or ".wav")
        temporary_path = Path(temporary.name)
        temporary.close()
    try:
        if voice_file is not None and temporary_path is not None:
            voice_file.save(str(temporary_path))
        instance = _load_model()
        with model_lock:
            audio = _generate(
                instance,
                text,
                str(temporary_path) if temporary_path is not None else None,
                str(request.form.get("ref_text") or ""),
                request.form,
            )
        data, sample_rate = audio_response(audio, 24000)
        response = app.response_class(data, mimetype="audio/wav")
        response.headers["X-Sample-Rate"] = str(sample_rate)
        return response
    except Exception as exc:
        logger.exception("OmniVoice generation failed")
        return jsonify({"error": str(exc), "engine": "omnivoice"}), 503
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@app.get("/")
def index():
    return jsonify(_status())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("CHATTERBOX_PORT", "3036")), threaded=True)
