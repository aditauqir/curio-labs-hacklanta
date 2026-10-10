#!/usr/bin/env bash
# Starts the offline Whisper speech-to-text server. It listens on 127.0.0.1 only,
# so it is never reachable from outside the machine; the Next.js app calls it.
#
#   bash scripts/whisper-run.sh                 # foreground, for local dev
#   pm2 start scripts/whisper-run.sh --name whisper --interpreter bash   # on the server
#
# Environment overrides (match the values used for whisper-setup.sh):
#   WHISPER_DIR, WHISPER_MODEL (default base.en), WHISPER_PORT (default 8178),
#   WHISPER_THREADS (default: all cores), WHISPER_LANGUAGE (default en)
set -euo pipefail

WHISPER_DIR="${WHISPER_DIR:-$HOME/.curio-whisper}"
WHISPER_MODEL="${WHISPER_MODEL:-base.en}"
WHISPER_PORT="${WHISPER_PORT:-8178}"
WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-en}"
WHISPER_THREADS="${WHISPER_THREADS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)}"

BIN="$WHISPER_DIR/whisper.cpp/build/bin/whisper-server"
MODEL_FILE="$WHISPER_DIR/whisper.cpp/models/ggml-$WHISPER_MODEL.bin"

if [ ! -x "$BIN" ] || [ ! -s "$MODEL_FILE" ]; then
  echo "Whisper is not installed. Run: bash scripts/whisper-setup.sh" >&2
  exit 1
fi

# --suppress-nst drops non-speech tokens such as [MUSIC] and (applause).
exec "$BIN" \
  -m "$MODEL_FILE" \
  --host 127.0.0.1 \
  --port "$WHISPER_PORT" \
  -t "$WHISPER_THREADS" \
  -l "$WHISPER_LANGUAGE" \
  --suppress-nst
