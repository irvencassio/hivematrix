#!/usr/bin/env bash
# HiveMatrix local-model installer for a new machine.
#
# Picks the standard local model by RAM (per the 2026-07-04 bake-off,
# tools/model-bench/):
#   >= 120GB unified memory  -> DeepSeek V4 Flash q2-q4 via ds4/DwarfStar (:8000)
#   <  120GB                 -> Qwen3.6-35B-A3B via rapid-mlx (:8090)
#                               (8bit >= 48GB, else 4bit)
# Then prints the HiveMatrix Settings selection to finish wiring.
set -euo pipefail

RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
echo "Detected ${RAM_GB}GB unified memory."

install_ds4() {
  local dir="$HOME/dwarfstar-ds4"
  if [ ! -d "$dir" ]; then
    echo "Cloning ds4 (DwarfStar)..."
    git clone https://github.com/antirez/ds4 "$dir"
    (cd "$dir" && make)
  fi
  if [ ! -e "$dir/ds4flash.gguf" ]; then
    echo "Downloading DeepSeek V4 Flash q2-q4 (~91GB)..."
    (cd "$dir" && ./download_model.sh q2-q4-imatrix)
  fi
  local plist="$HOME/Library/LaunchAgents/com.$(whoami).dwarfstar.ds4.plist"
  if [ ! -f "$plist" ]; then
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.$(whoami).dwarfstar.ds4</string>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>ProgramArguments</key>
  <array>
    <string>$dir/ds4-server</string>
    <string>--ctx</string><string>100000</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8000</string>
    <string>--kv-disk-dir</string><string>$HOME/.ds4/server-kv</string>
    <string>--kv-disk-space-mb</string><string>131072</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.ds4/ds4-serve.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.ds4/ds4-serve.launchd.log</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string></dict>
</dict>
</plist>
EOF
    mkdir -p "$HOME/.ds4"
    launchctl bootstrap "gui/$(id -u)" "$plist"
  fi
  echo
  echo "DeepSeek V4 Flash q2-q4 serving on http://127.0.0.1:8000/v1"
  echo "In HiveMatrix Settings -> Models, pick: Dwarf Star DeepSeek V4 Flash."
}

install_rapid_mlx_qwen() {
  local quant="8bit"
  [ "$RAM_GB" -lt 48 ] && quant="4bit"
  if ! command -v rapid-mlx >/dev/null 2>&1; then
    echo "Installing rapid-mlx..."
    python3 -m pip install --user rapid-mlx --break-system-packages || python3 -m pip install --user rapid-mlx
    export PATH="$PATH:$HOME/Library/Python/3.12/bin:$HOME/Library/Python/3.13/bin"
  fi
  echo "Pulling Qwen3.6-35B-A3B ${quant}..."
  rapid-mlx pull "qwen3.6-35b-${quant}"
  local plist="$HOME/Library/LaunchAgents/com.$(whoami).rapidmlx.qwen.plist"
  if [ ! -f "$plist" ]; then
    local bin
    bin=$(command -v rapid-mlx)
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.$(whoami).rapidmlx.qwen</string>
  <key>ProgramArguments</key>
  <array>
    <string>$bin</string>
    <string>serve</string>
    <string>qwen3.6-35b-${quant}</string>
    <string>--port</string><string>8090</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.hivematrix/rapidmlx-qwen.log</string>
  <key>StandardErrorPath</key><string>$HOME/.hivematrix/rapidmlx-qwen.log</string>
</dict>
</plist>
EOF
    mkdir -p "$HOME/.hivematrix"
    launchctl bootstrap "gui/$(id -u)" "$plist"
  fi
  echo
  echo "Qwen3.6-35B-A3B (${quant}) serving on http://127.0.0.1:8090/v1"
  echo "In HiveMatrix Settings -> Models, pick: Qwen3.6-35B (Rapid-MLX)."
}

if [ "$RAM_GB" -ge 120 ]; then
  echo "-> Installing DeepSeek V4 Flash q2-q4 via ds4 (recommended for ${RAM_GB}GB)."
  install_ds4
else
  echo "-> Installing Qwen3.6-35B-A3B via rapid-mlx (recommended for ${RAM_GB}GB)."
  install_rapid_mlx_qwen
fi
