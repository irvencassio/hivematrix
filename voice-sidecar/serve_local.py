"""Local browser test harness for the realtime pipeline (P5.1 validation).

Proves the SmallWebRTC pipeline end-to-end from a browser ON THE MAC, before any
iOS work: open the page, allow the mic, and talk to your local assistant — STT →
local LLM → cloned voice, with Pipecat VAD turn-taking + barge-in.

    .venv/bin/python serve_local.py          # then open http://127.0.0.1:7860

Needs LM Studio (or HIVE_LLM_* set) serving the local model and a recorded voice
profile. This is a DEV harness — production signaling is relayed by the daemon
(P5.2). The browser already does echo cancellation (getUserMedia), so barge-in
works without headphones here.
"""
import argparse
import asyncio

from aiohttp import web

from realtime import answer_offer

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<title>HiveMatrix voice (local test)</title>
<style>body{font:16px -apple-system,sans-serif;max-width:38rem;margin:3rem auto;padding:0 1rem;color:#0f1a20}
button{font:inherit;padding:.6rem 1.1rem;border-radius:.6rem;border:0;background:#16302a;color:#fff;cursor:pointer}
#log{white-space:pre-wrap;margin-top:1rem;color:#456}</style></head><body>
<h2>HiveMatrix — local voice test</h2>
<p>Click Connect, allow the mic, and just talk. (P5.1 validation harness.)</p>
<button id=go>Connect</button>
<audio id=remote autoplay></audio>
<div id=log></div>
<script>
const log = (m) => document.getElementById('log').textContent += m + "\\n";
document.getElementById('go').onclick = async () => {
  const pc = new RTCPeerConnection();
  pc.ontrack = (e) => { document.getElementById('remote').srcObject = e.streams[0]; log('▸ receiving audio'); };
  pc.onconnectionstatechange = () => log('state: ' + pc.connectionState);
  const stream = await navigator.mediaDevices.getUserMedia({audio: true});
  pc.addTransceiver(stream.getAudioTracks()[0], {direction: 'sendrecv'});  // explicit mic up + bot down
  await pc.setLocalDescription(await pc.createOffer());
  // wait for ICE gathering to finish (non-trickle — simplest for a local test)
  await new Promise(r => { if (pc.iceGatheringState === 'complete') r();
    else pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && r()); });
  log('▸ sending offer');
  const resp = await fetch('/offer', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sdp: pc.localDescription.sdp, type: pc.localDescription.type})});
  await pc.setRemoteDescription(await resp.json());
  log('▸ connected — start talking');
};
</script></body></html>"""


async def index(_request):
    return web.Response(text=PAGE, content_type="text/html")


async def offer(request):
    body = await request.json()
    answer = await answer_offer({"sdp": body["sdp"], "type": body["type"]})
    return web.json_response(answer)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7860)
    args = ap.parse_args()

    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_post("/offer", offer)
    print(f"open http://{args.host}:{args.port}  (Ctrl-C to stop)", flush=True)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
