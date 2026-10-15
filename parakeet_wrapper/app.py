import os
import gc
import logging
import datetime
import tempfile
import shutil
import math
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
import uvicorn

# --- onnxruntime CUDA bootstrap (MUST run before onnx_asr/onnxruntime build a session) ---
# torch (2.7.x+cuXXX) bundles the CUDA 12 / cuDNN 9 DLLs onnxruntime-gpu needs (cublasLt64_12.dll,
# cudnn*.dll) under site-packages/torch/lib, but that dir is not on the Windows DLL search path
# unless torch is imported first. onnxruntime>=1.19 exposes preload_dlls() which finds torch/lib and
# loads them; without it, onnxruntime_providers_cuda.dll fails ("cublasLt64_12.dll missing, Error 126")
# once per session and silently falls back to CPU.
try:
    import onnxruntime as _ort
    _ort.set_default_logger_severity(3)  # 3=ERROR: quiet repeated provider-init warnings
    if hasattr(_ort, "preload_dlls"):
        _ort.preload_dlls(cuda=True, cudnn=True, msvc=True)
except Exception as _e:
    logging.getLogger(__name__).debug(f"onnxruntime CUDA preload skipped: {_e}")

# --- Prefer the bundled ffmpeg/ffprobe over any system install ---
# pydub (AudioSegment, below) decodes/resamples audio by shelling out to whatever ffmpeg/ffprobe it
# finds on PATH. Prepend the ffmpeg we ship in node_modules (Remotion's per-platform compositor dir
# bundles BOTH ffmpeg and ffprobe) so ASR preprocessing never depends on a system install — matching
# how the Node server and yt-dlp resolve ffmpeg (see server/services/shared/ffmpegUtils.js).
def _prepend_bundled_ffmpeg_to_path():
    import glob
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    exe = 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'
    for pattern in (
        os.path.join(root, 'node_modules', '@remotion', 'compositor-*', exe),
        os.path.join(root, 'node_modules', '@ffmpeg-installer', '*', exe),
    ):
        for candidate in glob.glob(pattern):
            if os.path.isfile(candidate):
                bin_dir = os.path.dirname(candidate)
                os.environ['PATH'] = bin_dir + os.pathsep + os.environ.get('PATH', '')
                return bin_dir
    return None

_prepend_bundled_ffmpeg_to_path()

from onnx_asr import load_model
from pydub import AudioSegment
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal, List

# --- Configuration and Logging Setup ---

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("ASR_MODEL_NAME", "istupakov/parakeet-tdt-0.6b-v3-onnx")
app_state = {}

# --- FastAPI Lifespan Management ---

def _cuda_actually_works() -> bool:
    """Build a throwaway session forced onto CUDA. True only if it actually binds
    CUDAExecutionProvider (not a silent CPU fallback)."""
    try:
        import onnxruntime as ort
        from onnx import helper, TensorProto
        x = helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 2])
        y = helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 2])
        node = helper.make_node("Identity", ["X"], ["Y"])
        graph = helper.make_graph([node], "probe", [x], [y])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
        model.ir_version = 9
        sess = ort.InferenceSession(
            model.SerializeToString(),
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        return "CUDAExecutionProvider" in sess.get_providers()
    except Exception:
        return False


def _select_providers():
    """Return an ordered onnxruntime provider list, GPU-first, filtered to what this runtime build
    can ACTUALLY bind (not just what it lists). Falls back cleanly to CPU."""
    try:
        import onnxruntime as ort
        available = set(ort.get_available_providers())
    except Exception as e:
        logger.warning(f"Could not query onnxruntime providers: {e}")
        return None
    preferred = [
        "CUDAExecutionProvider",   # onnxruntime-gpu (NVIDIA)
        "DmlExecutionProvider",    # onnxruntime-directml (Windows AMD/Intel)
        "CoreMLExecutionProvider", # macOS
        "CPUExecutionProvider",    # always-present fallback
    ]
    chosen = [p for p in preferred if p in available]
    # CUDA is "available" (listed) even when its DLLs cannot load. Verify once and drop it if it would
    # only fall back to CPU -- this stops the per-session "Failed to create CUDAExecutionProvider" flood.
    if "CUDAExecutionProvider" in chosen and not _cuda_actually_works():
        logger.warning("CUDAExecutionProvider is listed but failed to initialize "
                       "(missing CUDA/cuDNN DLLs or unsupported GPU); using CPU.")
        chosen = [p for p in chosen if p != "CUDAExecutionProvider"]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")
    return chosen


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Loading ASR model: {MODEL_NAME}...")
    providers = _select_providers()
    app_state["providers"] = providers
    app_state["active_provider"] = None
    try:
        if providers:
            logger.info(f"Requesting onnxruntime providers (in order): {providers}")
            model = load_model(MODEL_NAME, providers=providers)
        else:
            model = load_model(MODEL_NAME)
        wrapped = model.with_timestamps()
        app_state["asr_model"] = wrapped
        # Report the provider onnxruntime ACTUALLY bound (inspect the underlying session) rather than
        # blindly echoing the requested preference -- otherwise we'd claim CUDA on a silent CPU fallback.
        active = None
        try:
            import onnxruntime as ort
            inner = getattr(wrapped, "asr", wrapped)
            for attr in vars(inner).values():
                if isinstance(attr, ort.InferenceSession):
                    active = attr.get_providers()[0]
                    break
        except Exception as e:
            logger.debug(f"Could not introspect bound provider: {e}")
        app_state["active_provider"] = active or (providers[0] if providers else "CPUExecutionProvider")
        if app_state["active_provider"] == "CUDAExecutionProvider":
            logger.info("ASR model loaded on GPU (CUDAExecutionProvider).")
        else:
            logger.info(f"ASR model loaded on {app_state['active_provider']} (CPU or non-CUDA).")
    except Exception as e:
        logger.error(f"Failed to load ASR model: {e}", exc_info=True)
        app_state["asr_model"] = None

    yield

    logger.info("Cleaning up resources...")
    app_state.clear()
    gc.collect()
    logger.info("Shutdown complete.")

# --- FastAPI App Initialization ---

app = FastAPI(
    title="Parakeet Speech Transcription API",
    version="1.0.0",
    lifespan=lifespan
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# --- Helper Functions ---

def format_srt_time(seconds: float) -> str:
    if seconds < 0: seconds = 0.0
    delta = datetime.timedelta(seconds=seconds)
    hours, remainder = divmod(int(delta.total_seconds()), 3600)
    minutes, secs = divmod(remainder, 60)
    milliseconds = delta.microseconds // 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"

def generate_srt_content(segment_timestamps: list) -> str:
    srt_content = []
    for i, ts in enumerate(segment_timestamps):
        start_time = format_srt_time(ts['start'])
        end_time = format_srt_time(ts['end'])
        text = ts['segment']
        srt_content.append(str(i + 1))
        srt_content.append(f"{start_time} --> {end_time}")
        srt_content.append(text)
        srt_content.append("")
    return "\n".join(srt_content)

def _group_tokens_into_words(tokens: list, timestamps: list) -> list:
    words = []
    current_word_tokens = []
    current_word_start_time = None
    if not tokens: return []
    for i, token in enumerate(tokens):
        if current_word_start_time is None:
            current_word_start_time = timestamps[i]
        if token.startswith(" "):
            if current_word_tokens:
                word_text = "".join(current_word_tokens).strip()
                words.append({"text": word_text, "start": current_word_start_time})
            current_word_tokens = [token]
            current_word_start_time = timestamps[i]
        else:
            current_word_tokens.append(token)
    if current_word_tokens:
        word_text = "".join(current_word_tokens).strip()
        words.append({"text": word_text, "start": current_word_start_time})
    return words

def _split_sentence_evenly(sentence_words: List[dict], max_words: int) -> List[dict]:
    """
    Splits a list of words into evenly balanced segments.
    If max_words is -1, the sentence is preserved as a single segment.
    """
    total_words = len(sentence_words)
    if not sentence_words:
        return []

    # --- MODIFIED LOGIC ---
    # Condition to return a single, unsplit segment:
    # 1. The user explicitly requested to preserve sentences (-1).
    # 2. The sentence is already at or below the desired max word count.
    if max_words == -1 or total_words <= max_words:
        return [{
            'start': sentence_words[0]['start'],
            'end': sentence_words[-1]['end'],
            'segment': " ".join(w['text'] for w in sentence_words)
        }]

    # Distribute words as evenly as possible across multiple lines
    num_lines = math.ceil(total_words / max_words)
    base_words_per_line = total_words // num_lines
    extra_words = total_words % num_lines

    segments = []
    current_word_index = 0
    for i in range(num_lines):
        words_in_this_line = base_words_per_line + (1 if i < extra_words else 0)
        chunk = sentence_words[current_word_index : current_word_index + words_in_this_line]
        if not chunk: continue

        segments.append({
            'start': chunk[0]['start'],
            'end': chunk[-1]['end'],
            'segment': " ".join(w['text'] for w in chunk)
        })
        current_word_index += words_in_this_line

    return segments

def process_timestamped_result(timestamped_result, audio_duration_sec: float, segment_strategy: str, max_chars: int, max_words: int, pause_threshold: float) -> list:
    AVG_CHAR_DURATION = 0.07

    timestamps = timestamped_result.timestamps
    tokens = timestamped_result.tokens
    if not timestamps or not tokens: return []

    words = _group_tokens_into_words(tokens, timestamps)
    if not words: return []

    for i, word in enumerate(words):
        is_last_word = (i == len(words) - 1)
        estimated_speech_duration = len(word['text']) * AVG_CHAR_DURATION
        estimated_end_time = word['start'] + estimated_speech_duration

        if not is_last_word:
            word['end'] = min(estimated_end_time, words[i+1]['start'])
        else:
            word['end'] = min(estimated_end_time, audio_duration_sec)

    all_segments = []

    if segment_strategy == 'sentence':
        sentence_buffer = []
        for i, word in enumerate(words):
            sentence_buffer.append(word)
            is_last_word_of_all = (i == len(words) - 1)

            pause_after_word = (words[i+1]['start'] - word['end']) if not is_last_word_of_all else 0

            is_sentence_end = (
                is_last_word_of_all or
                pause_after_word >= pause_threshold or
                word['text'].strip().endswith(('.', '?', '!'))
            )

            if is_sentence_end and sentence_buffer:
                evenly_split_segments = _split_sentence_evenly(sentence_buffer, max_words)
                all_segments.extend(evenly_split_segments)
                sentence_buffer = []
    else:
        current_segment_words = []
        for i, word in enumerate(words):
            current_segment_words.append(word)
            current_text = " ".join(w['text'] for w in current_segment_words)
            is_last_word_of_all = (i == len(words) - 1)

            pause_after_word = (words[i+1]['start'] - word['end']) if not is_last_word_of_all else 0

            end_segment = False
            if is_last_word_of_all:
                end_segment = True
            elif pause_after_word >= pause_threshold:
                end_segment = True
            elif segment_strategy == 'word' and len(current_segment_words) >= max_words and max_words != -1:
                end_segment = True
            elif segment_strategy == 'char' and len(current_text) + (len(words[i+1]['text']) + 1 if not is_last_word_of_all else 0) > max_chars:
                end_segment = True

            if end_segment and current_segment_words:
                all_segments.append({
                    'start': current_segment_words[0]['start'],
                    'end': current_segment_words[-1]['end'],
                    'segment': " ".join(w['text'] for w in current_segment_words)
                })
                current_segment_words = []

    return all_segments

# --- Core Transcription Logic ---

def transcribe_audio(audio_path: str, model, segment_strategy: str, max_chars: int, max_words: int, pause_threshold: float) -> dict:
    if not model:
        raise HTTPException(status_code=503, detail="ASR model is not available.")

    try:
        audio = AudioSegment.from_file(audio_path)
        duration_sec = audio.duration_seconds
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not process audio file: {e}")

    target_sr = 16000
    transcribe_path = audio_path
    processed_audio_path = None

    if (audio.frame_rate != target_sr) or (audio.channels != 1):
        if audio.frame_rate != target_sr: audio = audio.set_frame_rate(target_sr)
        if audio.channels != 1: audio = audio.set_channels(1)
        with tempfile.NamedTemporaryFile(suffix='_processed.wav', delete=False) as temp_f:
            processed_audio_path = Path(temp_f.name)
        audio.export(processed_audio_path, format="wav")
        transcribe_path = str(processed_audio_path)

    try:
        result = model.recognize(transcribe_path)
        segment_timestamps = process_timestamped_result(result, duration_sec, segment_strategy, max_chars, max_words, pause_threshold)
        srt_content = generate_srt_content(segment_timestamps)
        return {
            "transcription": result.text,
            "segments": segment_timestamps,
            "srt_content": srt_content,
            "duration_seconds": duration_sec
        }
    finally:
        if processed_audio_path and processed_audio_path.exists():
            processed_audio_path.unlink()

# --- API Endpoints ---

@app.get("/")
async def root():
    return {"message": "Parakeet Speech Transcription API", "version": "1.0.0"}

@app.get("/health")
async def health():
    # Return NOT ready (503) when the ASR model failed to load (or hasn't yet), so the UI gates
    # honestly instead of letting users start jobs that then 503 per-request.
    model = app_state.get("asr_model")
    if model is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "model_loaded": False, "detail": "ASR model is not available."},
        )
    return {
        "status": "ok",
        "model_loaded": True,
        "model": MODEL_NAME,
        "provider": app_state.get("active_provider"),
        "providers": app_state.get("providers"),
    }

@app.post("/transcribe")
async def transcribe_endpoint(
    file: UploadFile = File(...),
    segment_strategy: str = Form("sentence", enum=["char", "sentence", "word"]),
    max_chars: int = Form(42, gt=10, le=200),
    max_words: int = Form(7, ge=-1, le=50), # MODIFIED: Allows -1
    pause_threshold: float = Form(0.8, gt=0.1, le=5.0)
):
    """
    Accepts an audio file and transcription parameters.

    - **segment_strategy**:
      - `sentence`: Breaks on pauses/punctuation, then evenly splits long sentences by `max_words`.
      - `word`: Breaks on pauses or when `max_words` is reached.
      - `char`: Breaks on pauses or when `max_chars` is reached.
    - **max_chars**: Character limit for the 'char' strategy.
    - **max_words**: Word limit for 'sentence' and 'word' strategies. Use -1 to preserve full sentences.
    - **pause_threshold**: Seconds of silence to trigger a new segment.
    """
    if max_words == 0:
        raise HTTPException(status_code=400, detail="max_words cannot be 0.")
    if not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail=f"Invalid file type: '{file.content_type}'.")

    temp_path = None
    try:
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            shutil.copyfileobj(file.file, temp_file)
            temp_path = temp_file.name

        asr_model = app_state.get("asr_model")
        result = transcribe_audio(temp_path, asr_model, segment_strategy, max_chars, max_words, pause_threshold)
        return JSONResponse(content=result)
    finally:
        if temp_path and Path(temp_path).exists():
            Path(temp_path).unlink()

class TranscribeBase64Request(BaseModel):
    audio_base64: str
    filename: Optional[str] = "audio.wav"
    segment_strategy: Literal['char', 'sentence', 'word'] = 'sentence'
    max_chars: int = 42
    max_words: int = 7 # Can be -1 to preserve sentences
    pause_threshold: float = 0.8

@app.post("/transcribe_base64")
async def transcribe_base64_endpoint(payload: TranscribeBase64Request):
    import base64
    if payload.max_words == 0:
        raise HTTPException(status_code=400, detail="max_words cannot be 0.")

    temp_path = None
    try:
        audio_b64 = payload.audio_base64
        if "," in audio_b64 and audio_b64.strip().startswith("data:"):
            audio_b64 = audio_b64.split(",", 1)[1]

        suffix = ''.join(Path(payload.filename).suffixes)
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            temp_path = Path(f.name)
            f.write(base64.b64decode(audio_b64))

        asr_model = app_state.get("asr_model")
        result = transcribe_audio(
            str(temp_path), asr_model, payload.segment_strategy,
            payload.max_chars, payload.max_words, payload.pause_threshold
        )
        return JSONResponse(content=result)
    finally:
        if temp_path and Path(temp_path).exists():
            Path(temp_path).unlink()

# --- Main Execution ---

if __name__ == "__main__":
    logger.info("Starting Parakeet ASR FastAPI server...")
    # access_log=False: stop the per-request "GET /health 200 OK" frontend-poll spam (warnings/errors still log).
    uvicorn.run(app, host="0.0.0.0", port=3038, access_log=False)
