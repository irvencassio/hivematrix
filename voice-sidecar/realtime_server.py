"""Headless realtime WebRTC signaling server (P5.2/P5.3).

The daemon spawns this once and relays the client's SmallWebRTC signaling to it;
we run the Pipecat pipeline and return the SDP answer. P2P media flows
phone↔here directly — the daemon only relays signaling.

Uses Pipecat's SmallWebRTCRequestHandler so it speaks the EXACT protocol the
Pipecat clients expect (web prebuilt + the iOS SDK): POST = offer (with pc_id +
renegotiation), PATCH = trickle ICE. This is why off-LAN/TURN + the iOS client
work, where a naive offer→answer endpoint would not.

One process handles many sessions. Binds 127.0.0.1 only (daemon is the sole
caller); prints `REALTIME_READY <port>` on stdout. ICE/TURN from HIVE_TURN_* env.

    .venv/bin/python realtime_server.py [--port N]
"""
import argparse
import asyncio
import os

from aiohttp import web

from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCRequest,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequestHandler,
)

from realtime import build_session, build_transport


def ice_servers():
    """ICE servers from HIVE_TURN_* env (empty = LAN-only)."""
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


_handler: SmallWebRTCRequestHandler | None = None


def handler() -> SmallWebRTCRequestHandler:
    global _handler
    if _handler is None:
        _handler = SmallWebRTCRequestHandler(ice_servers=ice_servers())
    return _handler


async def _on_connection(connection):
    """A new (or renegotiated) peer connected — build + run the pipeline on it."""
    quality = os.environ.get("HIVE_RT_TTS_QUALITY", "fast")
    transport = build_transport(connection)
    task, runner = await build_session(transport, tts_quality=quality)
    asyncio.create_task(runner.run(task))  # don't block the signaling response


async def handle_offer(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "expected JSON"}, status=400)
    req = SmallWebRTCRequest(
        sdp=body.get("sdp"), type=body.get("type"),
        pc_id=body.get("pc_id"), restart_pc=body.get("restart_pc"),
        request_data=body.get("request_data"),
    )
    answer = await handler().handle_web_request(req, _on_connection)
    return web.json_response(answer)


async def handle_patch(request: web.Request) -> web.Response:
    """Trickle-ICE / renegotiation updates from the client."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "expected JSON"}, status=400)
    preq = SmallWebRTCPatchRequest(**body)
    await handler().handle_patch_request(preq)
    return web.json_response({"ok": True})


async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def run(host: str, port: int):
    app = web.Application()
    app.router.add_post("/offer", handle_offer)
    app.router.add_patch("/offer", handle_patch)
    app.router.add_get("/health", handle_health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    bound = site._server.sockets[0].getsockname()[1]
    print(f"REALTIME_READY {bound}", flush=True)
    await asyncio.Event().wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0, help="0 = ephemeral (printed on stdout)")
    args = ap.parse_args()
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
