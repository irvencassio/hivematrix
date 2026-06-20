"""LLM turn for the VoiceBee sidecar — calls HiveMatrix's LOCAL model over its
OpenAI-compatible endpoint (the same local server the daemon routes to). All
config is env-driven so it tracks whatever the operator has serving locally:

    HIVE_LLM_BASE_URL  (default http://localhost:1234/v1 — LM Studio)
    HIVE_LLM_MODEL     (default qwen/qwen3.6-27b)
    HIVE_LLM_API_KEY   (default "local" — local servers ignore it)

When spawned by the daemon (/voice/turn) these are set from the operator's
configured Qwen profile (src/lib/voice/llm-env.ts), so the spoken loop uses the
same local model as the rest of HiveMatrix. The defaults below only apply when a
script is run standalone (e.g. talk.py) with nothing in the environment.

Keeping the loop local honors the Q12 "local-first" posture; no cloud call.
"""
import json
import os
import re
import subprocess

from openai import OpenAI

# Defaults match the operator's HiveMatrix local-model config (LM Studio serving
# Qwen 3.6 27B); override via env for a different local server.
DEFAULT_BASE_URL = os.environ.get("HIVE_LLM_BASE_URL", "http://localhost:1234/v1")
DEFAULT_MODEL = os.environ.get("HIVE_LLM_MODEL", "qwen/qwen3.6-27b")

# Spoken-style: short, no markdown — this text goes straight to TTS.
SYSTEM_PROMPT = (
    "You are the user's voice assistant speaking aloud. Reply in one or two short, "
    "natural spoken sentences, and make the FIRST sentence brief so it can be "
    "spoken immediately. No markdown, no lists, no emojis."
)

# Spoken replies are 1–2 short sentences, so cap generation tight. This also bounds
# worst-case latency: an unbounded budget let a runaway turn burn ~30s and still
# return empty (reasoning ate the budget). 160 tokens ≈ plenty for spoken output.
SPOKEN_MAX_TOKENS = 160

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)

# Qwen 3.6 is a reasoning model. In LM Studio its reasoning lands in a separate
# `reasoning_content` field and the spoken answer in `content` — but the reasoning
# still costs tokens + latency, so we (a) budget enough tokens for the answer to
# survive the reasoning, and (b) try to disable thinking via the chat-template
# flag. NOTE: with the current LM Studio build the flag is not honored, so for
# sub-second live voice the operator should turn reasoning OFF in LM Studio's
# model settings (or load a non-thinking model). Latency, not code, is the gate.
THINKING_OFF = {"chat_template_kwargs": {"enable_thinking": False}}

# --- Tools the spoken assistant can call (first one: read recent email). The
# sidecar runs on the Mac, so it reads Mail directly via osascript — the same
# surface MailBee uses. (Sending/safety-gated actions should route through the
# daemon's MailBee; reading is safe to do here.) ---
TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_recent_emails",
        "description": "Get the user's most recent inbox emails (sender + subject). "
                       "Use when the user asks about their email, inbox, or recent messages.",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "How many recent emails (default 5, max 15)"}},
        },
    },
}]


def _get_recent_emails(limit: int = 5) -> str:
    try:
        limit = max(1, min(int(limit or 5), 15))
    except (TypeError, ValueError):
        limit = 5
    script = (
        'tell application "Mail"\n'
        '  set out to ""\n'
        '  set msgs to messages of inbox\n'
        f'  set lim to {limit}\n'
        '  if (count of msgs) < lim then set lim to (count of msgs)\n'
        '  repeat with i from 1 to lim\n'
        '    set m to item i of msgs\n'
        '    set out to out & (sender of m) & " — " & (subject of m) & linefeed\n'
        '  end repeat\n'
        '  return out\n'
        'end tell'
    )
    try:
        # Bounded so a spurious tool call (small models sometimes invoke this for
        # non-email questions) or a slow Mail launch can't stall the spoken turn
        # for 30s. A real inbox read returns well within this.
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=12)
        if r.returncode != 0:
            return f"Could not read email: {(r.stderr or '').strip()[:160]}"
        return r.stdout.strip() or "No recent emails in the inbox."
    except subprocess.TimeoutExpired:
        return "The mail app did not respond in time."
    except Exception as e:  # noqa: BLE001 — never break the turn
        return f"Could not read email: {e}"


def _run_tool(name: str, args: dict) -> str:
    if name == "get_recent_emails":
        return _get_recent_emails(args.get("limit", 5))
    return f"Unknown tool: {name}"


class LocalLLM:
    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None):
        self.model = model or DEFAULT_MODEL
        self.client = OpenAI(
            base_url=base_url or DEFAULT_BASE_URL,
            api_key=api_key or os.environ.get("HIVE_LLM_API_KEY", "local"),
        )

    def respond(self, user_text: str, system: str = SYSTEM_PROMPT,
                history: list[dict] | None = None) -> str:
        messages = [{"role": "system", "content": system}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_text})
        resp = self.client.chat.completions.create(
            model=self.model, messages=messages, max_tokens=SPOKEN_MAX_TOKENS, temperature=0.4,
            extra_body=THINKING_OFF,
        )
        content = resp.choices[0].message.content or ""
        # Reasoning (if any) is in message.reasoning_content; ignore it for TTS.
        # Defensively strip any inline <think> block too.
        return _THINK_RE.sub("", content).strip()

    def respond_with_tools(self, user_text: str, system: str = SYSTEM_PROMPT,
                           history: list[dict] | None = None) -> str:
        """Like respond(), but the model may call a tool (e.g. read recent email)
        first. One tool round-trip, then a spoken-style summary. Falls back to a
        plain reply when the model doesn't call a tool or tools aren't supported."""
        messages: list[dict] = [{"role": "system", "content": system}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_text})
        try:
            first = self.client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=SPOKEN_MAX_TOKENS, temperature=0.4,
                tools=TOOLS, tool_choice="auto", extra_body=THINKING_OFF,
            )
        except Exception:  # noqa: BLE001 — server without tool support → plain reply
            return self.respond(user_text, system, history)
        msg = first.choices[0].message
        calls = getattr(msg, "tool_calls", None)
        if not calls:
            # No tool needed. If the model produced spoken content, use it; if it
            # came back empty (reasoning ate the budget, or a stray empty turn),
            # fall back to a plain reply so the user never hears silence.
            text = _THINK_RE.sub("", msg.content or "").strip()
            return text or self.respond(user_text, system, history)
        messages.append({
            "role": "assistant", "content": msg.content or "",
            "tool_calls": [{"id": c.id, "type": "function",
                            "function": {"name": c.function.name, "arguments": c.function.arguments}}
                           for c in calls],
        })
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except (TypeError, ValueError, json.JSONDecodeError):
                args = {}
            messages.append({"role": "tool", "tool_call_id": c.id,
                             "content": _run_tool(c.function.name, args)})
        final = self.client.chat.completions.create(
            model=self.model, messages=messages, max_tokens=SPOKEN_MAX_TOKENS, temperature=0.4,
            extra_body=THINKING_OFF,
        )
        text = _THINK_RE.sub("", final.choices[0].message.content or "").strip()
        # The post-tool summary occasionally comes back empty too — summarize the
        # tool result with a plain (toolless) reply rather than speak nothing.
        if not text:
            tool_context = "\n".join(m["content"] for m in messages if m.get("role") == "tool")
            text = self.respond(
                f"{user_text}\n\n(Information retrieved:\n{tool_context}\n)\nAnswer the user aloud.",
                system, history,
            )
        return text

    def respond_stream(self, user_text: str, system: str = SYSTEM_PROMPT,
                       history: list[dict] | None = None):
        """Yield reply text deltas as they stream — feed straight into iter_sentences."""
        messages = [{"role": "system", "content": system}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_text})
        stream = self.client.chat.completions.create(
            model=self.model, messages=messages, max_tokens=SPOKEN_MAX_TOKENS, temperature=0.4,
            extra_body=THINKING_OFF, stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            text = getattr(chunk.choices[0].delta, "content", None) or ""
            if text:
                yield text
