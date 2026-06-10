# Local FunASR

This directory contains local FunASR runtime files for GuGuDu video learning.

## Layout

- `models/SenseVoiceSmall/`: Hugging Face model snapshot.
- `models/faster-whisper-large-v3/`: local CTranslate2 faster-whisper model snapshot.
- `.venv/`: uv-managed Python environment, not committed.
- `start-funasr.sh`: starts the OpenAI-compatible ASR server.
- `start-faster-whisper.sh`: starts the OpenAI-compatible faster-whisper ASR server.
- `download-model.sh`: downloads the model through the local proxy.

## Download Model

```bash
cd local-asr/funasr
./download-model.sh
```

The script downloads `FunAudioLLM/SenseVoiceSmall` into `models/SenseVoiceSmall`.

## Start Server

```bash
cd local-asr/funasr
./start-funasr.sh
```

The scripts use `uv sync` and `uv run`. Install `uv` first if needed:

```bash
sudo dnf install -y uv
```

To sync dependencies only:

```bash
cd local-asr/funasr
./sync-env.sh
```

The server should expose:

```text
http://localhost:8899/v1/audio/transcriptions
```

Then set backend config:

```toml
[video_learning]
transcription_provider = "funasr"
transcription_base_url = "http://localhost:8899/v1"
transcription_api_key = ""
transcription_model = "sensevoice"
```

## Start faster-whisper

If `models/faster-whisper-large-v3` already exists:

```bash
cd local-asr/funasr
./start-faster-whisper.sh
```

Defaults:

```text
HOST=127.0.0.1
PORT=8899
MODEL_DIR=./models/faster-whisper-large-v3
DEVICE=cpu
COMPUTE_TYPE=int8
CPU_THREADS=4
```

Test the OpenAI-compatible endpoint:

```bash
curl -s http://localhost:8899/health

curl -s http://localhost:8899/v1/audio/transcriptions \
  -F model=faster-whisper-large-v3 \
  -F response_format=verbose_json \
  -F file=@/path/to/audio.wav
```

Backend config should point at the same base URL:

```toml
[video_learning]
transcription_provider = "faster-whisper"
transcription_base_url = "http://localhost:8899/v1"
transcription_api_key = ""
transcription_model = "faster-whisper-large-v3"
```
