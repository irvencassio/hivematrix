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
import traceback

from aiohttp import web

from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCRequest,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequestHandler,
)

# The realtime voice server always runs the Flash Lane pipeline: every voice turn
# is routed through the daemon's /flash/turn endpoint, so voice gets the full
# persona + session + brain + tool context (one pipeline, one system prompt).
# The direct local-model pipeline in realtime.py survives only as a
# daemon-independent dev harness (serve_local.py / `python realtime.py`).
from flash_pipeline import build_flash_session as build_session, build_transport  # noqa: F401


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
        traceback.print_exc()
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
        traceback.print_exc()
        return web.json_response({"error": "expected JSON"}, status=400)
    try:
        preq = _patch_request_from_json(body)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    await handler().handle_patch_request(preq)
    return web.json_response({"ok": True})


def _patch_request_from_json(body: dict) -> SmallWebRTCPatchRequest:
    pc_id = body.get("pc_id") or body.get("pcId")
    if not isinstance(pc_id, str) or not pc_id:
        raise ValueError("expected pc_id")
    raw_candidates = body.get("candidates", [])
    if raw_candidates is None:
        raw_candidates = []
    if not isinstance(raw_candidates, list):
        raise ValueError("expected candidates list")
    candidates = [_ice_candidate_from_json(c) for c in raw_candidates]
    candidates = [c for c in candidates if c is not None]
    return SmallWebRTCPatchRequest(pc_id=pc_id, candidates=candidates)


def _ice_candidate_from_json(candidate) -> IceCandidate | None:
    if isinstance(candidate, IceCandidate):
        return candidate
    if candidate is None:
        return None
    if not isinstance(candidate, dict):
        raise ValueError("expected candidate object")

    sdp = candidate.get("candidate")
    if not sdp:
        return None
    sdp_mid = candidate.get("sdp_mid", candidate.get("sdpMid"))
    sdp_mline_index = candidate.get("sdp_mline_index", candidate.get("sdpMLineIndex"))
    if sdp_mid is None or sdp_mline_index is None:
        raise ValueError("candidate missing sdp mid or m-line index")
    return IceCandidate(
        candidate=str(sdp),
        sdp_mid=str(sdp_mid),
        sdp_mline_index=int(sdp_mline_index),
    )


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
    # Warm the cloned-voice TTS model in the background (off the event loop) so the
    # first reply isn't cold — by the time STT+LLM produce text, the model is hot.
    try:
        from tts import warmup as _tts_warmup
        asyncio.create_task(asyncio.to_thread(_tts_warmup, os.environ.get("HIVE_RT_TTS_QUALITY", "fast")))
    except Exception:
        traceback.print_exc()
    await asyncio.Event().wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0, help="0 = ephemeral (printed on stdout)")
    args = ap.parse_args()
    asyncio.run(run(args.host, args.port))


if __name__ == "__main__":
    main()
