#!/usr/bin/env bash
# Builds whisper.cpp (OpenAI's Whisper speech model, C++ port) and downloads a
# speech model, so the microphone can transcribe offline with no API key.
# Works on Linux and macOS. Safe to re-run: finished steps are skipped.
#
#   bash scripts/whisper-setup.sh
#
# Environment overrides:
#   WHISPER_DIR      install location   (default: $HOME/.curio-whisper)
#   WHISPER_VERSION  whisper.cpp tag    (default: v1.9.5)
#   WHISPER_MODEL    model name         (default: base.en)
#                    tiny.en ~75 MB, base.en ~142 MB, small.en ~466 MB
set -euo pipefail

WHISPER_DIR="${WHISPER_DIR:-$HOME/.curio-whisper}"
WHISPER_VERSION="${WHISPER_VERSION:-v1.9.5}"
WHISPER_MODEL="${WHISPER_MODEL:-base.en}"
SRC="$WHISPER_DIR/whisper.cpp"

if ! [[ "$WHISPER_MODEL" =~ ^[a-z0-9._-]+$ ]]; then
  echo "Invalid WHISPER_MODEL: $WHISPER_MODEL" >&2
  exit 1
fi

for tool in git cmake curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 \
  || { echo "Missing a C++ compiler (install build-essential or Xcode command line tools)" >&2; exit 1; }

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

mkdir -p "$WHISPER_DIR"

if [ -d "$SRC/.git" ]; then
  echo "==> whisper.cpp already cloned at $SRC"
else
  echo "==> Cloning whisper.cpp $WHISPER_VERSION"
  git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp "$SRC"
fi

SERVER_BIN="$SRC/build/bin/whisper-server"
if [ -x "$SERVER_BIN" ]; then
  echo "==> whisper-server already built"
else
  echo "==> Building whisper-server with $JOBS jobs (a few minutes)"
  cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$SRC/build" -j "$JOBS" --config Release --target whisper-server whisper-cli
fi

MODEL_FILE="$SRC/models/ggml-$WHISPER_MODEL.bin"
if [ -s "$MODEL_FILE" ]; then
  echo "==> Model already downloaded: $MODEL_FILE"
else
  echo "==> Downloading model $WHISPER_MODEL"
  bash "$SRC/models/download-ggml-model.sh" "$WHISPER_MODEL"
fi

# A truncated download is the most common failure, so check the size.
SIZE_BYTES="$(wc -c < "$MODEL_FILE" | tr -d ' ')"
if [ "$SIZE_BYTES" -lt 50000000 ]; then
  echo "Model file looks truncated ($SIZE_BYTES bytes). Delete $MODEL_FILE and re-run." >&2
  exit 1
fi

echo
echo "Whisper is ready."
echo "  server: $SERVER_BIN"
echo "  model:  $MODEL_FILE ($((SIZE_BYTES / 1048576)) MB)"
echo "Start it with: bash scripts/whisper-run.sh"
