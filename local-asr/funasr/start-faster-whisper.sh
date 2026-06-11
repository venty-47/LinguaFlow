#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_DIR="${MODEL_DIR:-$SCRIPT_DIR/models/faster-whisper-large-v3}"
DEVICE="${DEVICE:-cpu}"
COMPUTE_TYPE="${COMPUTE_TYPE:-int8}"
DEFAULT_CPU_THREADS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
CPU_THREADS="${CPU_THREADS:-$DEFAULT_CPU_THREADS}"
BEAM_SIZE="${BEAM_SIZE:-1}"
NUM_WORKERS="${NUM_WORKERS:-1}"
VAD_FILTER="${VAD_FILTER:-true}"
VAD_MIN_SILENCE_MS="${VAD_MIN_SILENCE_MS:-500}"
CONDITION_ON_PREVIOUS_TEXT="${CONDITION_ON_PREVIOUS_TEXT:-false}"
NO_SPEECH_THRESHOLD="${NO_SPEECH_THRESHOLD:-0.6}"
LOG_PROB_THRESHOLD="${LOG_PROB_THRESHOLD:--1.0}"
COMPRESSION_RATIO_THRESHOLD="${COMPRESSION_RATIO_THRESHOLD:-2.4}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8899}"

export http_proxy="${http_proxy:-http://127.0.0.1:7897}"
export https_proxy="${https_proxy:-http://127.0.0.1:7897}"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}"
export MODEL_DIR DEVICE COMPUTE_TYPE CPU_THREADS BEAM_SIZE NUM_WORKERS VAD_FILTER
export VAD_MIN_SILENCE_MS CONDITION_ON_PREVIOUS_TEXT NO_SPEECH_THRESHOLD LOG_PROB_THRESHOLD COMPRESSION_RATIO_THRESHOLD

if [ ! -d "$MODEL_DIR" ]; then
  echo "Model directory not found: $MODEL_DIR"
  echo "Expected a CTranslate2 faster-whisper model, for example models/faster-whisper-large-v3."
  exit 1
fi

"$SCRIPT_DIR/sync-env.sh"

exec uv run uvicorn faster_whisper_server:app \
  --host "$HOST" \
  --port "$PORT"
