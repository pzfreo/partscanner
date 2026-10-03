#!/usr/bin/env bash
# Fetches the pinned homr OMR source (AGPL-3.0) and its fp32 ONNX models into
# vendor/ and models/, which the browser worker loads. Both dirs are gitignored.
set -euo pipefail

HOMR_COMMIT=863eb3c6487f3c6fe50267fb71613f05162bb7c5
BASE_URL=https://github.com/liebharc/homr/releases/download/onnx_checkpoints
MODELS=(
  segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f
  encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
  decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
)

cd "$(dirname "$0")/.."
mkdir -p vendor models

if [ ! -d vendor/homr-src/.git ]; then
  git init -q vendor/homr-src
  git -C vendor/homr-src remote add origin https://github.com/liebharc/homr.git
fi
git -C vendor/homr-src fetch -q --depth 1 origin "$HOMR_COMMIT"
git -C vendor/homr-src checkout -q FETCH_HEAD
rm -f vendor/homr.zip
(cd vendor/homr-src && zip -qr ../homr.zip homr LICENSE -x '*.onnx' '*__pycache__*' '*coreml_cache*')

for m in "${MODELS[@]}"; do
  if [ ! -f "models/$m.onnx" ]; then
    echo "Downloading $m"
    curl -fsSL -o "models/$m.zip" "$BASE_URL/$m.zip"
    unzip -o -q -j "models/$m.zip" '*.onnx' -d models
    rm "models/$m.zip"
  fi
done
ls -la models vendor/homr.zip
