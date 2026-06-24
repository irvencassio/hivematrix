#!/usr/bin/env python3
"""Persistent push-to-talk worker. Keeps STT and cloned-voice TTS
(VoxCPM) models warm across turns, so each Talk turn is just transcribe + LLM +
synth — NO per-turn model reload (the old turn_cli.py spawned fresh every turn,
reloading both models). The daemon's /voice/turn relays one turn here.

    POST /turn  {"audioBase64": "...", "lang": "en"}   # recorded audio → server STT
    POST /turn  {"text": "...", "lang": "en"}          # on-device transcript, skips STT
      -> {"transcript": "...", "reply": "...", "audioBase64": "<m4a b64>"}
    GET  /health -> {"ok": true}

Prints `TURN_READY <port>` on stdout once the models are warm. LLM endpoint comes
from HIVE_LLM_* (the daemon points it at the fast Rapid-MLX tier, reasoning off).
"""
import argparse
import asyncio
import base64
import os
import subprocess
import tempfile

from aiohttp import web

from stt import transcribe
from llm import LocalLLM, resolve_escalation
from tts import synthesize


def _one_turn(audio_b64: str, lang: str, text: str | None = None) -> dict:
    """Blocking: run one full turn against the warm models. When `text` is given
    (on-device STT), use it directly and skip server-side transcription."""
    work = tempfile.mkdtemp(prefix="hm-turn-")
    try:
        if text is not None:
            transcript = text
        else:
            inp = os.path.join(work, "in.webm")  # extension advisory; ffmpeg sniffs content
            with open(inp, "wb") as f:
                f.write(base64.b64decode(audio_b64))
            transcript = transcribe(inp)
        if not transcript.strip():
            return {"transcript": "", "reply": "", "audioBase64": "", "escalated": False}
        reply = LocalLLM().respond_with_tools(transcript)
        # Hand off to a full HiveMatrix agent task when the local model can't do the
        # ask (research, web/repo lookups) — and speak an acknowledgment, not a refusal.
        escalated, reply = resolve_escalation(transcript, reply)
        audio_out = ""
        if reply.strip():
            wav = synthesize(reply, quality="fast", lang=lang)
            m4a = os.path.join(work, "reply.m4a")
            # Match the old /voice/turn output format (AAC/m4a) so iOS is unchanged.
            try:
                subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", wav, m4a], check=True)
                src = m4a
            except Exception:
                src = wav  # fall back to WAV if afconvert is unavailable
            with open(src, "rb") as f:
                audio_out = base64.b64encode(f.read()).decode()
        return {"transcript": transcript, "reply": reply, "audioBase64": audio_out, "escalated": escalated}
    finally:
        try:
            for f in os.listdir(work):
                os.remove(os.path.join(work, f))
            os.rmdir(work)
        except OSError:
            pass


async def handle_turn(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "expected JSON"}, status=400)
    audio_b64 = body.get("audioBase64") or ""
    lang = body.get("lang") or "en"
    raw_text = body.get("text")
    text = raw_text.strip() if isinstance(raw_text, str) else ""
    if not text and not audio_b64:
        return web.json_response({"error": "text or audioBase64 is required"}, status=400)
    try:
        result = await asyncio.to_thread(_one_turn, audio_b64, lang, text or None)
    except Exception as e:  # noqa: BLE001 — return a clean error, keep the worker alive
        return web.json_response({"error": (str(e) or "turn failed")[-300:]}, status=500)
    return web.json_response(result)


def _warm() -> None:
    """Preload STT + TTS so the first real turn isn't cold."""
    try:
        wav = synthesize("Ready.", quality="fast", lang="en")  # warms Kokoro (live TTS)
        # Only warm STT when a backend is configured. On-device-STT clients send
        # text and never touch server STT, so a missing HIVE_STT_COMMAND is normal.
        if os.environ.get("HIVE_STT_COMMAND", "").strip():
            try:
                transcribe(wav)
            except Exception:
                pass
        try:
            os.remove(wav)
        except OSError:
            pass
    except Exception:
        pass


async def run(host: str, port: int) -> None:
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_post("/turn", handle_turn)
    app.router.add_get("/health", lambda _r: web.json_response({"ok": True}))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    bound = site._server.sockets[0].getsockname()[1]
    await asyncio.to_thread(_warm)
    print(f"TURN_READY {bound}", flush=True)
    await asyncio.Event().wait()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0)
    a = ap.parse_args()
    asyncio.run(run(a.host, a.port))


if __name__ == "__main__":
    main()
