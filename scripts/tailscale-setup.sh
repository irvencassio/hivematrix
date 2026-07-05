#!/usr/bin/env bash
#
# Bring the HiveMatrix Mac onto Tailscale so the phone/glasses reach the daemon
# over the private mesh — direct P2P voice, no TURN relay. The Apple Watch keeps
# using the named Cloudflare tunnel (it can't join a mesh).
#
# The one-time install + sign-in is YOURS (Tailscale opens a browser to
# authenticate your account). This script drives everything else and prints the
# tailnet pairing URL + token at the end. Safe to re-run (idempotent).
#
# See docs/TAILSCALE.md.
set -uo pipefail

PORT="${HIVEMATRIX_PORT:-3747}"
TOKEN_FILE="${HOME}/.hivematrix/auth-token"

find_ts() {
  for p in /opt/homebrew/bin/tailscale /usr/local/bin/tailscale \
           /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  command -v tailscale 2>/dev/null && return 0
  return 1
}

if ! TS="$(find_ts)"; then
  cat <<'EOF'
Tailscale is not installed. Install it, sign in, then re-run this script:

  # Homebrew (CLI + daemon):
  brew install tailscale && sudo brew services start tailscale
  # …or the macOS app:  https://tailscale.com/download

EOF
  exit 2
fi
echo "tailscale CLI: $TS"

# 1) Sign in / bring the tailnet up (interactive browser auth if not already up).
if ! "$TS" status >/dev/null 2>&1; then
  echo "Bringing Tailscale up — a browser window will open for sign-in…"
  "$TS" up || { echo "error: 'tailscale up' failed" >&2; exit 3; }
fi

# 2) Expose the loopback daemon to the tailnet (HTTPS -> 127.0.0.1:$PORT).
#    Serve syntax varies by Tailscale version; override with TS_SERVE_CMD.
SERVE_CMD="${TS_SERVE_CMD:-$TS serve --bg $PORT}"
echo "Serving the daemon on the tailnet:  $SERVE_CMD"
if ! eval "$SERVE_CMD" >/dev/null 2>&1; then
  echo "note: could not run the serve command automatically. Run the form your" >&2
  echo "      Tailscale version expects, e.g.:" >&2
  echo "        $TS serve --bg $PORT" >&2
  echo "        $TS serve --bg http://127.0.0.1:$PORT" >&2
fi

# 3) Print pairing info.
IP4="$("$TS" ip -4 2>/dev/null | head -1)"
DNS="$("$TS" status --json 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' 2>/dev/null)"
TOKEN="$(tr -d '\n' <"$TOKEN_FILE" 2>/dev/null)"

echo
echo "── Pair the phone over Tailscale ──────────────────────────────"
# `tailscale serve` publishes the loopback daemon as HTTPS on the MagicDNS name
# (port 443). That is the reachable pairing URL — NOT http://<ip>:$PORT, which a
# loopback-bound daemon never answers.
if [ -n "$DNS" ]; then
  echo "  URL (MagicDNS):   https://$DNS"
else
  echo "  URL:              (no MagicDNS name — enable MagicDNS in the Tailscale admin)"
fi
[ -n "$IP4" ] && echo "  Tailnet IP:       $IP4  (reachable once 'tailscale serve' is active)"
if [ -n "$TOKEN" ]; then
  echo "  Access token:     $TOKEN"
else
  echo "  Access token:     (not found at $TOKEN_FILE)"
fi
echo
echo "In the iOS app: paste the URL + token (or make a QR from them)."
echo "The daemon auto-detects on-mesh clients and serves STUN-only ICE (no TURN)."
echo "The Apple Watch stays on the named Cloudflare tunnel (hivey.cassio.io)."
