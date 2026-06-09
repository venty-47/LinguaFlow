#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_DIR="${MODEL_DIR:-$SCRIPT_DIR/models/SenseVoiceSmall}"
DEVICE="${DEVICE:-cpu}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8899}"

export http_proxy="${http_proxy:-http://127.0.0.1:7897}"
export https_proxy="${https_proxy:-http://127.0.0.1:7897}"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-300}"

if [ ! -d "$MODEL_DIR" ]; then
  echo "Model directory not found: $MODEL_DIR"
  echo "Run ./download-model.sh first."
  exit 1
fi

"$SCRIPT_DIR/sync-env.sh"

exec uv run funasr-server \
  --host "$HOST" \
  --port "$PORT" \
  --model "$MODEL_DIR" \
  --device "$DEVICE"
