from __future__ import annotations

import html
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from faster_whisper import WhisperModel


MODEL_DIR = os.getenv("MODEL_DIR", str(Path(__file__).parent / "models/faster-whisper-large-v3"))
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("CPU_THREADS", "4"))
NUM_WORKERS = int(os.getenv("NUM_WORKERS", "1"))
BEAM_SIZE = int(os.getenv("BEAM_SIZE", "5"))
VAD_FILTER = os.getenv("VAD_FILTER", "true").lower() in {"1", "true", "yes", "on"}
VAD_MIN_SILENCE_MS = int(os.getenv("VAD_MIN_SILENCE_MS", "500"))
CONDITION_ON_PREVIOUS_TEXT = os.getenv("CONDITION_ON_PREVIOUS_TEXT", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
NO_SPEECH_THRESHOLD = float(os.getenv("NO_SPEECH_THRESHOLD", "0.6"))
LOG_PROB_THRESHOLD = float(os.getenv("LOG_PROB_THRESHOLD", "-1.0"))
COMPRESSION_RATIO_THRESHOLD = float(os.getenv("COMPRESSION_RATIO_THRESHOLD", "2.4"))

app = FastAPI(title="GuGuDu faster-whisper ASR", version="0.1.0")
model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global model
    if model is None:
        if not Path(MODEL_DIR).exists():
            raise HTTPException(status_code=500, detail=f"Model directory not found: {MODEL_DIR}")
        model = WhisperModel(
            MODEL_DIR,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            cpu_threads=CPU_THREADS,
            num_workers=NUM_WORKERS,
            local_files_only=True,
        )
    return model


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model_dir": MODEL_DIR,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "loaded": model is not None,
    }


@app.post("/v1/audio/transcriptions", response_model=None)
async def transcribe(
    file: UploadFile = File(...),
    model_name: str | None = Form(default=None, alias="model"),
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    response_format: str = Form(default="json"),
    temperature: float = Form(default=0.0),
    word_timestamps: bool = Form(default=False),
) -> JSONResponse | PlainTextResponse:
    suffix = Path(file.filename or "audio").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        tmp.write(await file.read())

    started_at = time.monotonic()
    try:
        segments_iter, info = get_model().transcribe(
            tmp_path,
            language=language or None,
            initial_prompt=prompt or None,
            beam_size=BEAM_SIZE,
            vad_filter=VAD_FILTER,
            vad_parameters={"min_silence_duration_ms": VAD_MIN_SILENCE_MS},
            temperature=temperature,
            word_timestamps=word_timestamps,
            condition_on_previous_text=CONDITION_ON_PREVIOUS_TEXT,
            no_speech_threshold=NO_SPEECH_THRESHOLD,
            log_prob_threshold=LOG_PROB_THRESHOLD,
            compression_ratio_threshold=COMPRESSION_RATIO_THRESHOLD,
        )
        print(
            "[ASR] started "
            f"file={file.filename or 'audio'} "
            f"duration={format_console_time(info.duration)} "
            f"language={language or 'auto'} "
            f"device={DEVICE} compute={COMPUTE_TYPE} beam={BEAM_SIZE}",
            flush=True,
        )
        segments = []
        for segment in segments_iter:
            item = _segment_to_dict(segment, word_timestamps)
            segments.append(item)
            print_transcription_progress(item, info.duration, len(segments), started_at)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    text = "".join(segment["text"] for segment in segments).strip()
    fmt = response_format.lower()
    elapsed = time.monotonic() - started_at
    print(
        "[ASR] completed "
        f"segments={len(segments)} "
        f"elapsed={format_elapsed(elapsed)} "
        f"speed={format_speed(info.duration, elapsed)}",
        flush=True,
    )

    if fmt == "text":
        return PlainTextResponse(text)
    if fmt == "srt":
        return PlainTextResponse(to_srt(segments), media_type="application/x-subrip")
    if fmt == "vtt":
        return PlainTextResponse(to_vtt(segments), media_type="text/vtt")

    payload: dict[str, Any] = {"text": text}
    if fmt == "verbose_json" or fmt == "json":
        payload.update(
            {
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "model": model_name or Path(MODEL_DIR).name,
                "segments": segments,
            }
        )
    return JSONResponse(payload)


def _segment_to_dict(segment: Any, include_words: bool) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": segment.id,
        "start": round(float(segment.start), 3),
        "end": round(float(segment.end), 3),
        "text": segment.text,
        "avg_logprob": segment.avg_logprob,
        "compression_ratio": segment.compression_ratio,
        "no_speech_prob": segment.no_speech_prob,
    }
    if include_words and segment.words:
        item["words"] = [
            {
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "word": word.word,
                "probability": word.probability,
            }
            for word in segment.words
        ]
    return item


def to_srt(segments: list[dict[str, Any]]) -> str:
    blocks = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            f"{index}\n"
            f"{format_srt_time(segment['start'])} --> {format_srt_time(segment['end'])}\n"
            f"{segment['text'].strip()}\n"
        )
    return "\n".join(blocks)


def to_vtt(segments: list[dict[str, Any]]) -> str:
    cues = ["WEBVTT", ""]
    for segment in segments:
        text = html.escape(segment["text"].strip())
        cues.append(f"{format_vtt_time(segment['start'])} --> {format_vtt_time(segment['end'])}")
        cues.append(text)
        cues.append("")
    return "\n".join(cues)


def print_transcription_progress(
    segment: dict[str, Any],
    duration: float,
    count: int,
    started_at: float,
) -> None:
    end = float(segment.get("end") or 0)
    percent = 0.0
    if duration > 0:
        percent = min(100.0, max(0.0, end / duration * 100))
    elapsed = time.monotonic() - started_at
    text = " ".join(str(segment.get("text") or "").split())
    if len(text) > 80:
        text = text[:77] + "..."
    print(
        "[ASR] "
        f"{percent:6.2f}% "
        f"{format_console_time(end)} / {format_console_time(duration)} "
        f"segments={count} "
        f"elapsed={format_elapsed(elapsed)} "
        f"text={text}",
        flush=True,
    )


def format_console_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    total = int(round(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours:02}:{minutes:02}:{secs:02}"
    return f"{minutes:02}:{secs:02}"


def format_elapsed(seconds: float) -> str:
    return format_console_time(seconds)


def format_speed(duration: float, elapsed: float) -> str:
    if elapsed <= 0:
        return "n/a"
    return f"{duration / elapsed:.2f}x"


def format_srt_time(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, rem = divmod(millis, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def format_vtt_time(seconds: float) -> str:
    return format_srt_time(seconds).replace(",", ".")
