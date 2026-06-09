# Local FunASR

This directory contains local FunASR runtime files for GuGuDu video learning.

## Layout

- `models/SenseVoiceSmall/`: Hugging Face model snapshot.
- `.venv/`: uv-managed Python environment, not committed.
- `start-funasr.sh`: starts the OpenAI-compatible ASR server.
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
transcription_model = "../local-asr/funasr/models/SenseVoiceSmall"
```
