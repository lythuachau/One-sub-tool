from __future__ import annotations

import importlib.util
import logging
import os
import re
import threading
import time
from functools import lru_cache
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
cancel_lock = threading.Lock()
cancelled_generations: dict[str, float] = {}


class GenerationCancelled(Exception):
    pass


def _validate_generation_id(value: Any) -> str:
    generation_id = str(value or "")
    if generation_id and not re.fullmatch(r"generation_[A-Za-z0-9_-]{1,112}", generation_id):
        raise ValueError("Invalid OmniVoice generation_id")
    return generation_id


def _raise_if_cancelled(generation_id: str) -> None:
    if not generation_id:
        return
    with cancel_lock:
        cancelled_at = cancelled_generations.get(generation_id)
    if cancelled_at is not None and time.monotonic() - cancelled_at < 3600:
        raise GenerationCancelled(generation_id)


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


@lru_cache(maxsize=1)
def _load_language_catalog() -> tuple[dict[str, str], ...]:
    package_spec = importlib.util.find_spec("omnivoice")
    package_paths = package_spec.submodule_search_locations if package_spec else None
    if not package_paths:
        raise RuntimeError("OmniVoice package is not installed")

    language_map_path = Path(next(iter(package_paths))) / "utils" / "lang_map.py"
    language_spec = importlib.util.spec_from_file_location("_omnivoice_language_map", language_map_path)
    if language_spec is None or language_spec.loader is None:
        raise RuntimeError("OmniVoice language catalog is missing")

    language_map = importlib.util.module_from_spec(language_spec)
    language_spec.loader.exec_module(language_map)
    names_to_ids = getattr(language_map, "LANG_NAME_TO_ID", {})
    display_name = getattr(language_map, "lang_display_name", lambda name: name.title())
    if not names_to_ids:
        raise RuntimeError("OmniVoice language catalog is empty")

    languages = [
        {"code": str(code), "name": display_name(name)}
        for name, code in names_to_ids.items()
    ]
    return tuple(sorted(languages, key=lambda language: (language["name"].casefold(), language["code"])))


def _language_catalog() -> list[dict[str, str]]:
    try:
        return list(_load_language_catalog())
    except Exception as exc:
        logger.warning("Could not load OmniVoice language catalog: %s", exc)
        return []


@app.get("/languages")
@app.get("/api/narration/languages")
def languages():
    catalog = _language_catalog()
    if not catalog:
        return jsonify({
            "success": False,
            "languages": [],
            "count": 0,
            "error": "OmniVoice language catalog is unavailable",
        }), 503
    return jsonify({"success": True, "engine": "omnivoice", "languages": catalog, "count": len(catalog)})


def _model_catalog() -> dict[str, Any]:
    available, import_error = package_available("omnivoice")
    model_id = os.getenv("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
    languages = _language_catalog()
    state = "ready" if model is not None else ("loading" if model_loading else ("error" if model_error else "not_loaded"))
    model_info = {
        "id": model_id,
        "name": "OmniVoice",
        "engine": "omnivoice",
        "provider": "local",
        "language": "multi",
        "languages": [language["code"] for language in languages],
        "language_count": len(languages),
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


@app.post("/tts/cancel")
def cancel_generation():
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValueError("A JSON object with generation_id is required")
        generation_id = _validate_generation_id(payload.get("generation_id"))
        if not generation_id:
            raise ValueError("OmniVoice generation_id is required")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    now = time.monotonic()
    with cancel_lock:
        expired = [key for key, timestamp in cancelled_generations.items() if now - timestamp >= 3600]
        for key in expired:
            del cancelled_generations[key]
        cancelled_generations[generation_id] = now
    logger.info("OmniVoice cancellation requested generation=%s", generation_id)
    return jsonify({"cancelled": True, "generation_id": generation_id})


@app.post("/tts/generate")
def generate():
    try:
        generation_id = _validate_generation_id(request.form.get("generation_id"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
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
        _raise_if_cancelled(generation_id)
        if voice_file is not None and temporary_path is not None:
            voice_file.save(str(temporary_path))
        instance = _load_model()
        while not model_lock.acquire(timeout=0.1):
            _raise_if_cancelled(generation_id)
        try:
            _raise_if_cancelled(generation_id)
            logger.info("OmniVoice synthesis started generation=%s", generation_id or "preview")
            audio = _generate(
                instance,
                text,
                str(temporary_path) if temporary_path is not None else None,
                str(request.form.get("ref_text") or ""),
                request.form,
            )
            _raise_if_cancelled(generation_id)
        finally:
            model_lock.release()
        data, sample_rate = audio_response(audio, 24000)
        _raise_if_cancelled(generation_id)
        response = app.response_class(data, mimetype="audio/wav")
        response.headers["X-Sample-Rate"] = str(sample_rate)
        return response
    except GenerationCancelled:
        logger.info("OmniVoice result discarded generation=%s", generation_id)
        return jsonify({"cancelled": True, "generation_id": generation_id}), 409
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
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("OMNIVOICE_PORT", os.getenv("CHATTERBOX_PORT", "3036"))),
        threaded=True,
    )
