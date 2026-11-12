#!/usr/bin/env bash
# Gera os modelos .glb do jogo a partir dos scripts do Blender (docs/design/MODELOS.md).
# Uso: tools/models/build.sh [modelo ...]   (sem argumentos: todos)
# Precisa do Blender 4.5 em $BLENDER (padrão: /tmp/blender/blender-4.5.16-linux-x64/blender). No Codespace faltam
# bibliotecas do sistema que o Blender pede mesmo sem janela: o script cria versões vazias delas (ver README.md).
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="${BLENDER:-/tmp/blender/blender-4.5.16-linux-x64/blender}"
OUT=../../src/assets/models
PREVIEW="${PREVIEW:-}"
STUBS=/tmp/blender/stubs
if [ ! -x "$BLENDER" ]; then
  echo "Blender não encontrado em $BLENDER (veja tools/models/README.md)" >&2
  exit 1
fi
if ! LD_LIBRARY_PATH="$STUBS" "$BLENDER" -b --version >/dev/null 2>&1; then
  mkdir -p "$STUBS"
  echo "" > "$STUBS/empty.c"
  for l in libXfixes.so.3 libXi.so.6 libxkbcommon.so.0 libSM.so.6 libICE.so.6 libGL.so.1; do
    gcc -shared -fPIC -o "$STUBS/$l" -Wl,-soname,"$l" "$STUBS/empty.c"
  done
fi
models=("$@")
if [ ${#models[@]} -eq 0 ]; then
  models=()
  for f in *.py; do [ "$f" != lib.py ] && models+=("${f%.py}"); done
fi
for m in "${models[@]}"; do
  echo "== $m"
  args=("$OUT/$m.glb")
  [ -n "$PREVIEW" ] && args+=("$PREVIEW/$m.png")
  LD_LIBRARY_PATH="$STUBS" "$BLENDER" -b -P "$m.py" -- "${args[@]}" 2>&1 | grep -E "TRIANGULOS|Error|Traceback|line [0-9]+" || true
  ls -la "$OUT/$m.glb"
done
