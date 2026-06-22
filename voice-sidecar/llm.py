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

# Spoken-style: short, no markdown — this text goes straight to TTS. The tool
# guidance is explicit because a small model otherwise over-calls the email tool
# for unrelated questions (time, calendar, weather), stalling the spoken turn.
SYSTEM_PROMPT = (
    "You are the user's voice assistant speaking aloud. Reply in one or two short, "
    "natural spoken sentences, and make the FIRST sentence brief so it can be "
    "spoken immediately. No markdown, no lists, no emojis.\n"
    "Only call a tool when the user explicitly asks about that exact thing. The "
    "email tool is ONLY for questions about their email, inbox, or mail messages. "
    "For anything else — the time, date, weather, calendar, math, or general "
    "questions — just answer directly and do NOT call any tool.\n"
    "If the user asks you to remind them of something, follow up on something, add "
    "a task, or create a note, reply with exactly: 'Got it — I've added that to "
    "your HiveMatrix tasks.' Do not try to set the reminder yourself."
)

# Spoken replies are 1–2 short sentences, so cap generation tight. This also bounds
# worst-case latency: an unbounded budget let a runaway turn burn ~30s and still
# return empty (reasoning ate the budget). 160 tokens ≈ plenty for spoken output.
SPOKEN_MAX_TOKENS = 160

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)

# Phrases that signal the model couldn't answer — triggers task escalation to HiveMatrix.
_UNCERTAIN_RE = re.compile(
    r"\b(i(?:'m| am) not (?:sure|certain)|i don't know|i have no (?:information|idea)|"
    r"i don't have (?:information|access|that information)|i can't (?:answer|help with that)|"
    r"i(?:'m| am) unable to (?:answer|help)|i cannot (?:answer|help with)|"
    r"beyond my (?:knowledge|capabilities)|i lack (?:the )?(?:information|knowledge)|"
    r"not (?:something i|able to) (?:know|answer))\b",
    re.I,
)


def is_uncertain(reply: str) -> bool:
    """True when the spoken reply signals the model couldn't answer the question."""
    return bool(_UNCERTAIN_RE.search(reply or ""))


# Phrases in the user's OWN words that mean "please create a task / reminder".
# Checked against the TRANSCRIPT (not the reply) — escalation fires even when the
# model successfully acknowledged the request.
_TASK_TRIGGER_RE = re.compile(
    r"\b("
    r"remind\s+me|reminder\s+(?:to|about|for)|"
    r"remember\s+to|make\s+a\s+note|note\s+to\s+(?:self|me)|"
    r"don'?t\s+forget|"
    r"follow[\s-]up|"
    r"add\s+(?:this\s+)?to\s+(?:my\s+)?(?:tasks?|to[- ]?do|list)|"
    r"create\s+(?:a\s+)?(?:task|reminder|to[- ]?do)|"
    r"new\s+task|"
    r"put\s+(?:this\s+)?on\s+(?:my\s+)?(?:list|tasks?)"
    r")\b",
    re.I,
)


def wants_task(transcript: str) -> bool:
    """True when the user's spoken words explicitly request a task or reminder."""
    return bool(_TASK_TRIGGER_RE.search(transcript or ""))

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
        "description": "Read the user's recent INBOX EMAILS — returns the sender, subject, "
                       "date, and a content preview for each. Use for ANY email question: how "
                       "many, who the senders are, the subjects, or reading/summarizing a recent "
                       "email. Use limit=1 for 'the last/latest email', a larger limit to list "
                       "several. Call ONLY for email/inbox/mail questions; answer the time, date, "
                       "calendar, weather, and other non-email questions directly without it.",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "How many recent emails (default 5, max 15). Use 1 for the latest email."}},
        },
    },
}]


def _get_recent_emails(limit: int = 5) -> str:
    try:
        limit = max(1, min(int(limit or 5), 15))
    except (TypeError, ValueError):
        limit = 5
    # Sender + subject + date + a content preview per message, so the model can
    # answer "how many", "who are the senders", "what's the subject", AND "read /
    # summarize the last email" from one call. Body is truncated (spoken replies
    # summarize, never read verbatim) to keep the osascript fast.
    script = (
        'tell application "Mail"\n'
        '  set out to ""\n'
        '  set msgs to messages of inbox\n'
        f'  set lim to {limit}\n'
        '  if (count of msgs) < lim then set lim to (count of msgs)\n'
        '  repeat with i from 1 to lim\n'
        '    set m to item i of msgs\n'
        '    set theBody to ""\n'
        '    try\n'
        '      set theBody to content of m\n'
        '    end try\n'
        '    if (count of characters of theBody) > 400 then set theBody to (text 1 thru 400 of theBody) & "..."\n'
        '    set out to out & "[" & i & "] From: " & (sender of m) & linefeed\n'
        '    set out to out & "Subject: " & (subject of m) & linefeed\n'
        '    try\n'
        '      set out to out & "Date: " & ((date received of m) as string) & linefeed\n'
        '    end try\n'
        '    set out to out & "Preview: " & theBody & linefeed & "----" & linefeed\n'
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
        out = r.stdout.strip()
        return re.sub(r"\n{3,}", "\n\n", out) if out else "No recent emails in the inbox."
    except subprocess.TimeoutExpired:
        return "The mail app did not respond in time."
    except Exception as e:  # noqa: BLE001 — never break the turn
        return f"Could not read email: {e}"


def _run_tool(name: str, args: dict) -> str:
    if name == "get_recent_emails":
        return _get_recent_emails(args.get("limit", 5))
    return f"Unknown tool: {name}"


# Deterministic gate: only OFFER the email tool when the user actually mentions
# email. The small local model can't reliably decide on its own — at any
# temperature it fires the tool on unrelated questions (time/calendar/math) 50–75%
# of the time, stalling the spoken turn. A keyword pre-check is 100% predictable.
# Cover the natural email phrasings — not just "email/inbox/mail" but "senders",
# "messages", and "who sent/emailed me" — so asks like "list the senders" or "read
# the last message" reach the tool. None of these match time/calendar/weather/math.
_EMAIL_RE = re.compile(
    r"\b(e-?mails?|inbox|mailbox|mail|senders?|messages?|correspondence|"
    r"who\s+(?:sent|e-?mailed|wrote|messaged)(?:\s+me)?)\b",
    re.I,
)


def _mentions_email(text: str) -> bool:
    return bool(_EMAIL_RE.search(text or ""))


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
        """Like respond(), but when the user asks about email the model may call a
        tool (read recent email) first, then give a spoken-style summary. The tool
        is only offered when the text mentions email (see _mentions_email) — every
        other question goes straight to a plain reply, so no spurious tool stalls."""
        if not _mentions_email(user_text):
            return self.respond(user_text, system, history)
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
