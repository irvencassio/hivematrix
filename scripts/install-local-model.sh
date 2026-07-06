#!/usr/bin/env bash
# HiveMatrix local-model installer for a new Mac.
#
# This script removes the retired ds4/DwarfStar install path, then provisions
# Qwen through Rapid-MLX according to the same memory presets HiveMatrix uses at
# runtime:
#   < 32GB  -> frontier-only, no local model
#   32/48GB -> Qwen3.6-35B-A3B fast tier (:8000)
#   64GB+   -> Qwen3.6-35B-A3B fast (:8000) + Qwen3.6-27B coding (:8001)
set -euo pipefail

RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
USER_ID="$(id -u)"
USER_NAME="$(whoami)"
echo "Detected ${RAM_GB}GB unified memory."

uninstall_retired_ds4() {
  local plist="$HOME/Library/LaunchAgents/com.${USER_NAME}.dwarfstar.ds4.plist"
  if [ -f "$plist" ]; then
    echo "Unloading retired ds4 LaunchAgent..."
    launchctl bootout "gui/${USER_ID}" "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
  fi

  if pgrep -f "ds4-server|ds4-agent" >/dev/null 2>&1; then
    echo "Stopping retired ds4 processes..."
    pkill -f "ds4-server|ds4-agent" >/dev/null 2>&1 || true
  fi

  if [ -d "$HOME/dwarfstar-ds4" ]; then
    echo "Removing ~/dwarfstar-ds4..."
    rm -rf "$HOME/dwarfstar-ds4"
  fi
  if [ -d "$HOME/.ds4" ]; then
    echo "Removing ~/.ds4..."
    rm -rf "$HOME/.ds4"
  fi
}

rapid_mlx_bin() {
  command -v rapid-mlx 2>/dev/null || true
}

ensure_rapid_mlx() {
  local bin
  bin="$(rapid_mlx_bin)"
  if [ -n "$bin" ]; then
    echo "$bin"
    return
  fi

  echo "Installing rapid-mlx..." >&2
  python3 -m pip install --user rapid-mlx --break-system-packages || python3 -m pip install --user rapid-mlx
  export PATH="$PATH:$HOME/.local/bin:$HOME/Library/Python/3.12/bin:$HOME/Library/Python/3.13/bin"
  bin="$(rapid_mlx_bin)"
  if [ -z "$bin" ]; then
    echo "rapid-mlx installed but not found on PATH. Add ~/.local/bin or ~/Library/Python/*/bin to PATH, then retry." >&2
    exit 1
  fi
  echo "$bin"
}

write_launch_agent() {
  local label="$1"
  local plist="$2"
  local bin="$3"
  local alias="$4"
  local port="$5"

  if [ -f "$plist" ]; then
    launchctl bootout "gui/${USER_ID}" "$plist" >/dev/null 2>&1 || true
  fi

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>serve</string>
    <string>${alias}</string>
    <string>--port</string><string>${port}</string>
    <string>--no-thinking</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${HOME}/.hivematrix/${label}.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.hivematrix/${label}.log</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>${HOME}</string></dict>
</dict>
</plist>
EOF
  launchctl bootstrap "gui/${USER_ID}" "$plist" >/dev/null 2>&1 || launchctl kickstart -k "gui/${USER_ID}/${label}" >/dev/null 2>&1 || true
}

install_qwen_tier() {
  local bin="$1"
  local tier="$2"
  local alias="$3"
  local port="$4"
  local label="com.${USER_NAME}.rapidmlx.qwen.${tier}"
  local plist="$HOME/Library/LaunchAgents/${label}.plist"

  echo "Pulling ${alias}..."
  "$bin" pull "$alias"
  mkdir -p "$HOME/.hivematrix"
  write_launch_agent "$label" "$plist" "$bin" "$alias" "$port"
  echo "${alias} serving on http://127.0.0.1:${port}/v1"
}

uninstall_retired_ds4

if [ "$RAM_GB" -lt 32 ]; then
  echo "-> ${RAM_GB}GB is below the local-Qwen tier. HiveMatrix will use frontier-only mode."
  exit 0
fi

RAPID_MLX="$(ensure_rapid_mlx)"

echo "-> Installing Qwen fast tier with Rapid-MLX."
install_qwen_tier "$RAPID_MLX" "fast" "qwen3.6-35b-4bit" "8000"

if [ "$RAM_GB" -ge 64 ]; then
  echo "-> Installing Qwen coding tier with Rapid-MLX."
  install_qwen_tier "$RAPID_MLX" "coding" "qwen3.6-27b-4bit" "8001"
fi

echo
echo "HiveMatrix local Qwen is configured through Rapid-MLX."
echo "Run: npx tsx scripts/qwen-readiness.mts"
