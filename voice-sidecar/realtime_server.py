"""Headless realtime WebRTC signaling server (P5.2).

The daemon spawns this once and proxies the client's SDP offer to POST /offer;
we run the Pipecat pipeline (realtime.answer_offer) and return the SDP answer.
P2P media flows phone↔here directly — the daemon only relays signaling. ICE
servers (Cloudflare STUN/TURN, for remote/off-LAN) come from HIVE_TURN_* env.

One process handles many sessions (each offer builds its own connection +
pipeline). Binds 127.0.0.1 only — the daemon is the sole caller. The chosen port
is printed as `REALTIME_READY <port>` on stdout so the daemon can capture an
ephemeral port (--port 0).

    .venv/bin/python realtime_server.py [--port N]
"""
import argparse
import asyncio
import os

from aiohttp import web

from realtime import answer_offer


def ice_servers():
    """Build the ICE server list from HIVE_TURN_* env (empty = LAN-only)."""
    raw = os.environ.get("HIVE_TURN_URLS", "").strip()
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    if not urls:
        return []
    from aiortc import RTCIceServer
    user = os.environ.get("HIVE_TURN_USERNAME")
    cred = os.environ.get("HIVE_TURN_CREDENTIAL")
    if user and cred:
        return [RTCIceServer(urls=urls, username=user, credential=cred)]
    return [RTCIceServer(urls=urls)]


async def handle_offer(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        sdp, typ = body["sdp"], body["type"]
    except Exception:
        return web.json_response({"error": "expected JSON {sdp, type}"}, status=400)
    quality = os.environ.get("HIVE_RT_TTS_QUALITY", "fast")
    answer = await answer_offer({"sdp": sdp, "type": typ}, ice_servers=ice_servers(), tts_quality=quality)
    return web.json_response(answer)


async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def run(host: str, port: int):
    app = web.Application()
    app.router.add_post("/offer", handle_offer)
    app.router.add_get("/health", handle_health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    bound = site._server.sockets[0].getsockname()[1]  # resolve ephemeral port
    print(f"REALTIME_READY {bound}", flush=True)
    await asyncio.Event().wait()  # run until killed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0, help="0 = ephemeral (printed on stdout)")
    args = ap.parse_args()
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
