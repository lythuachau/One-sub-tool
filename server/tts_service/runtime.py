from __future__ import annotations

import io
import importlib.util
import os
import re
import tempfile
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
NARRATION_DIR = ROOT_DIR / "narration"
REFERENCE_DIR = NARRATION_DIR / "reference"
OUTPUT_DIR = NARRATION_DIR / "output"
REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def subtitle_text(subtitle: dict[str, Any]) -> str:
    return clean_text(
        subtitle.get("text")
        or subtitle.get("translated_text")
        or subtitle.get("translation")
        or subtitle.get("original_text")
    )


def subtitle_id(subtitle: dict[str, Any], index: int) -> str:
    value = subtitle.get("id") or subtitle.get("subtitle_id") or f"{index + 1}"
    return clean_text(value).replace("/", "_").replace("\\", "_") or str(index + 1)


def resolve_reference_audio(value: Any) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    candidates = [Path(raw), REFERENCE_DIR / Path(raw).name]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate.resolve())
    return None


def output_path(segment_id: str) -> Path:
    directory = OUTPUT_DIR / f"subtitle_{segment_id}"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "1.wav"


def audio_parts(value: Any, default_rate: int) -> tuple[Any, int]:
    sample_rate = default_rate
    audio = value
    if isinstance(value, tuple) and len(value) >= 2:
        audio, possible_rate = value[0], value[1]
        if isinstance(possible_rate, (int, float)):
            sample_rate = int(possible_rate)
    elif hasattr(value, "audio"):
        audio = value.audio
        possible_rate = getattr(value, "sample_rate", None)
        if isinstance(possible_rate, (int, float)):
            sample_rate = int(possible_rate)
    if isinstance(audio, list) and audio and not hasattr(audio, "dtype"):
        audio = audio[0]
    return audio, sample_rate


def write_wav(value: Any, destination: Path, default_rate: int) -> int:
    import numpy as np
    import soundfile as sf

    audio, sample_rate = audio_parts(value, default_rate)
    array = np.asarray(audio)
    if array.ndim > 1 and array.shape[0] < array.shape[1]:
        array = array.T
    if array.size == 0:
        raise ValueError("TTS returned empty audio")
    array = np.nan_to_num(array).astype(np.float32, copy=False)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    sf.write(str(temporary), array, sample_rate, format="WAV", subtype="PCM_16")
    temporary.replace(destination)
    return sample_rate


def device_info() -> dict[str, Any]:
    requested = os.getenv("TTS_DEVICE", "auto").lower()
    try:
        import torch

        cuda = bool(torch.cuda.is_available())
        if requested == "cuda" and not cuda:
            return {"requested": requested, "device": "unavailable", "cuda_available": False}
        actual = "cuda" if requested == "cuda" or (requested == "auto" and cuda) else "cpu"
        return {"requested": requested, "device": actual, "cuda_available": cuda}
    except Exception as exc:
        return {"requested": requested, "device": "cpu", "cuda_available": False, "error": str(exc)}


def package_available(package_name: str) -> tuple[bool, str | None]:
    try:
        if importlib.util.find_spec(package_name) is None:
            return False, f"{package_name} is not installed"
        return True, None
    except Exception as exc:
        return False, f"{package_name} is not ready: {exc}"


def temporary_reference(suffix: str = ".wav") -> tempfile.NamedTemporaryFile:
    return tempfile.NamedTemporaryFile(prefix="osg_ref_", suffix=suffix, dir=str(REFERENCE_DIR), delete=False)


def audio_response(value: Any, default_rate: int):
    import numpy as np
    import soundfile as sf

    audio, sample_rate = audio_parts(value, default_rate)
    array = np.asarray(audio)
    if array.ndim > 1 and array.shape[0] < array.shape[1]:
        array = array.T
    array = np.nan_to_num(array).astype(np.float32, copy=False)
    buffer = io.BytesIO()
    sf.write(buffer, array, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return buffer.getvalue(), sample_rate
