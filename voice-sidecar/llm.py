"""LLM turn for the Voice Lane sidecar — calls HiveMatrix's LOCAL model over its
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
import traceback

from openai import OpenAI

# Defaults match the operator's HiveMatrix local-model config (LM Studio serving
# Qwen 3.6 27B); override via env for a different local server.
DEFAULT_BASE_URL = os.environ.get("HIVE_LLM_BASE_URL", "http://localhost:1234/v1")
DEFAULT_MODEL = os.environ.get("HIVE_LLM_MODEL", "qwen/qwen3.6-27b")

# Spoken-style: short, no markdown — this text goes straight to TTS. The tool
# guidance is explicit because a small model otherwise over-calls the surface Mail Lane uses for unrelated questions (time, calendar, weather), stalling the spoken turn before the request can reach the daemon's Mail Lane correctly.
_APP_VERSION = os.environ.get("HIVE_APP_VERSION", "")
_VERSION_LINE = f"The current HiveMatrix app version is {_APP_VERSION}. " if _APP_VERSION else ""

SYSTEM_PROMPT = (
    "You are the user's voice assistant speaking aloud. Reply in one or two short, "
    "natural spoken sentences, and make the FIRST sentence brief so it can be "
    "spoken immediately. No markdown, no lists, no emojis.\n"
    + _VERSION_LINE
    + "Call a tool ONLY when the user explicitly asks about that exact thing:\n"
    "- their email, inbox, or mail → the email tool\n"
    "- their texts, iMessages, or messages → the messages tool\n"
    "- their calendar, schedule, meetings, or whether they're free → the calendar tool\n"
    "- their reminders or to-dos → the reminders tool\n"
    "- a person's phone number or email address → the contacts tool\n"
    "- the current time or today's date → the datetime tool\n"
    "For the weather, news, prices, web searches, math, or general knowledge, do NOT "
    "call any tool — answer directly or follow the handoff rules below.\n"
    "If the user asks you to REMIND them of something ('remind me to X', 'set a "
    "reminder for X at 5'), call the create_reminder tool with the reminder text "
    "and their words about when — it sets a real Reminder on their devices. Then "
    "confirm briefly.\n"
    "If the user asks you to follow up on something, add a task, or create a note "
    "(not a reminder), reply with exactly: 'Got it — I've added that to your "
    "HiveMatrix tasks.'\n"
    "If the user asks you to use Browser Lane, open a website, search the web, browse "
    "a page, or navigate to a URL — reply with exactly: 'I'll open that in Browser "
    "Lane now.' Do not try to browse yourself; HiveMatrix Browser Lane will handle it.\n"
    "If the user asks you to research something, look something up, fetch the news, "
    "or check the app's repo, build, or pull requests — work you can't do live — do "
    "NOT refuse and do NOT say you lack access; HiveMatrix will pick it up. Just say "
    "you're looking into it.\n"
    "If the user asks you to message, text, iMessage, email, or send something to "
    "someone — work you can't do live — do NOT refuse and do NOT claim you sent it. "
    "Just say you'll send it; HiveMatrix will deliver it."
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


# A "stall" reply: the local model PROMISED async work it has no tools to do
# ("I'm looking into that", "let me check", "I'll find out") — a false promise.
# The fix for the weather bug: treat these as a handoff so a real task spawns
# (and we speak the honest ESCALATION_ACK) instead of dropping the promise.
_STALL_RE = re.compile(
    r"\b(i'?m\s+(?:looking|checking)\s+(?:into|on|up)|"
    r"let\s+me\s+(?:look|check|find|see|pull|grab)|"
    r"i'?ll\s+(?:look|check|find\s+out|get\s+(?:back|that|right)|pull|grab|see)|"
    r"give\s+me\s+a\s+(?:moment|second|sec|minute)|one\s+(?:moment|second)|"
    r"looking\s+that\s+up|checking\s+(?:on\s+)?that|hold\s+on\s+while\s+i)\b",
    re.I,
)


def is_stall(reply: str) -> bool:
    """True when the reply is a false promise to do async work the local model can't."""
    return bool(_STALL_RE.search(reply or ""))


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


# A canned "I can't do that" refusal from the local model. The small voice model
# answers fast Q&A + email but can't research, browse, or query the repo/build,
# so for those asks it tends to decline ("I cannot perform external research",
# "I don't have access to external tools"). HiveMatrix's full agent CAN do them,
# so a refusal is our cue to hand off — and to speak an acknowledgment, never the
# refusal itself. Two checks: a refusal OPENER (refusals lead with it) plus a few
# distinctive phrases that signal a refusal anywhere in the reply.
# NOTE: a bare leading "I can't"/"I cannot" is NOT a refusal opener on its own
# ("I can't wait to help!") — those are caught below only when a capability verb
# follows. The opener covers the unambiguous declines.
_REFUSAL_OPENER_RE = re.compile(
    r"^\W*(i (?:am not able to|am unable to|don'?t have|do not have)|"
    r"unfortunately,?\s+i|i'?m (?:not able|unable|afraid)|"
    r"as an?\s+(?:ai|language model|assistant))",
    re.I,
)
_REFUSAL_ANYWHERE_RE = re.compile(
    r"\b(i don'?t have access to|i don'?t have (?:real-?time|the ability)|"
    r"i can'?t (?:access|create|perform|look\s+up|check|browse|search|fetch|retrieve)|"
    r"i cannot (?:access|perform|browse|search|look\s+up|fetch|retrieve)|"
    r"you'?ll need to (?:check|do|compile|provide|look))\b",
    re.I,
)


def is_refusal(reply: str) -> bool:
    """True when the spoken reply is a canned 'I can't do that' refusal."""
    r = reply or ""
    return bool(_REFUSAL_OPENER_RE.search(r) or _REFUSAL_ANYWHERE_RE.search(r))


# The user's words asking for work the local voice model can't do live — research,
# web/news lookups, repo/build/PR queries. Checked against the TRANSCRIPT so the
# handoff fires even if the model confidently (and wrongly) answers instead of
# refusing. HiveMatrix's full agent has web search, brain search, and code-graph.
_RESEARCH_TRIGGER_RE = re.compile(
    r"\b("
    r"research|investigate|look\s+(?:up|into)|dig\s+into|find\s+out|"
    r"search\s+(?:for|online|the\s+web)|google\s+(?:it|for|this|that)?|"
    r"latest\s+news|today'?s\s+news|news\s+(?:items?|today|stories|headlines)|"
    r"pull\s+request|pr\s+(?:number|request)|last\s+build|latest\s+build|"
    r"give\s+(?:me\s+)?an?\s+assessment|assess\s+(?:whether|if|the|how)|"
    # Real-time / external info the local model can't know — must hand off.
    r"weather|forecast|temperature|how\s+(?:hot|cold|warm)|"
    r"(?:will|is)\s+it\s+(?:rain|snow|going\s+to\s+rain|going\s+to\s+snow)|"
    r"stock\s+price|share\s+price|price\s+of|market\s+(?:price|cap)|"
    r"current\s+(?:weather|price|temperature|score|events?)|"
    # "time in <place>" / "time is it in <place>" needs another timezone (handed
    # off); the plain local time ("what time is it") is answered live by the datetime
    # tool, NOT escalated — so the "in <place>" suffix is what triggers the handoff.
    r"time\s+(?:is\s+it\s+)?in\s+\w+|exchange\s+rate"
    r")\b",
    re.I,
)


def needs_research(transcript: str) -> bool:
    """True when the user asks for research / a lookup the local model can't do."""
    return bool(_RESEARCH_TRIGGER_RE.search(transcript or ""))


# The user asking to SEND an outbound message — text / iMessage / SMS / email to
# a person. The local voice model can't send, so this MUST hand off to a full
# HiveMatrix agent task (which has the outbound SMS/email tools). Checked against
# the TRANSCRIPT so the handoff fires even when the model "politely acknowledges"
# (the bug: it said "added to your tasks" but nothing escalated, so no task spawned).
#
# Precise, not greedy: a bare comms NOUN must not fire ("what does my email say",
# "do I have any messages" are reads, not sends). Four high-signal shapes instead:
#   send <comms-noun>                  → "send a text", "send her an email"
#   <comms-verb> as the imperative     → "message Joe", "can you text my wife"
#   <comms-verb> ... to <recipient>    → "reply to Sam", "email to the team"
#   tell <x> that / let <x> know       → relayed messages
_OUTBOUND_SEND_RE = re.compile(
    r"\bsend\s+(?:\w+\s+){0,2}"
    r"(?:message|text|sms|imessage|i-?message|email|e-?mail|note|reply)\b", re.I,
)
_OUTBOUND_IMPERATIVE_RE = re.compile(
    r"^(?:\W*(?:please|hey|ok|okay|yeah|go|now|can\s+you|could\s+you|would\s+you|"
    r"will\s+you|i\s+need\s+you\s+to|i\s+want\s+you\s+to|i\s+want\s+to)\s+){0,4}"
    r"(?:message|text|imessage|i-?message|email|e-?mail|ping|dm|shoot)\b", re.I,
)
_OUTBOUND_TO_RE = re.compile(
    r"\b(?:message|text|email|e-?mail|reply|write|send)\s+(?:back\s+)?to\s+\w+", re.I,
)
_OUTBOUND_RELAY_RE = re.compile(
    r"\b(?:tell\s+\w+\s+(?:that|to|i'?m|we'?re|about|the)|let\s+\w+\s+know)\b", re.I,
)


def wants_outbound(transcript: str) -> bool:
    """True when the user asks to send a message/text/email to someone."""
    t = transcript or ""
    return bool(
        _OUTBOUND_SEND_RE.search(t)
        or _OUTBOUND_IMPERATIVE_RE.search(t)
        or _OUTBOUND_TO_RE.search(t)
        or _OUTBOUND_RELAY_RE.search(t)
    )


# Spoken acknowledgment for a handoff — short, honest (the escalated task runs the
# full agent in the background), and mirrors the reminder acknowledgment's tone.
ESCALATION_ACK = "Got it — I'm looking into that now and I've added it to your HiveMatrix tasks."
OUTBOUND_ACK = "Got it — I'll send that for you. It's queued in your HiveMatrix tasks."


def resolve_escalation(transcript: str, reply: str,
                       tool_runs: list[dict] | None = None) -> tuple[bool, str]:
    """Decide whether a spoken turn escalates to a full HiveMatrix agent task, and
    pick the reply to speak. A handoff fires when the model couldn't answer
    (is_uncertain / is_refusal) or the user asked for capability the local model
    lacks (needs_research). Sending a message/text/email (wants_outbound) ALSO
    escalates — the local model can't send, so a full agent task must spawn (else
    we'd say "sent"/"added" with nothing in the queue). An explicit reminder/task
    ask (wants_task) escalates but keeps the model's own acknowledgment — UNLESS
    the turn already set a real Reminder live (a successful create_reminder in
    tool_runs): the work is done, so spawning a duplicate task would be wrong.
    Returns (escalated, spoken_reply)."""
    reminder_done = any(
        r.get("name") == "create_reminder" and str(r.get("output", "")).startswith("Reminder set")
        for r in (tool_runs or [])
    )
    handoff = is_uncertain(reply) or is_refusal(reply) or is_stall(reply) or needs_research(transcript)
    if reminder_done:
        # The live write succeeded; a stall/uncertainty phrasing can't undo it.
        return False, reply
    outbound = wants_outbound(transcript)
    escalated = handoff or outbound or wants_task(transcript)
    if outbound:
        spoken = OUTBOUND_ACK
    elif handoff:
        spoken = ESCALATION_ACK
    else:
        spoken = reply
    return escalated, spoken

# Qwen 3.6 is a reasoning model. In LM Studio its reasoning lands in a separate
# `reasoning_content` field and the spoken answer in `content` — but the reasoning
# still costs tokens + latency, so we (a) budget enough tokens for the answer to
# survive the reasoning, and (b) try to disable thinking via the chat-template
# flag. NOTE: with the current LM Studio build the flag is not honored, so for
# sub-second live voice the operator should turn reasoning OFF in LM Studio's
# model settings (or load a non-thinking model). Latency, not code, is the gate.
THINKING_OFF = {"chat_template_kwargs": {"enable_thinking": False}}

# --- Local tools the spoken assistant can call. All are READ-ONLY and run on the
# Mac (osascript / sqlite / the system clock), so they answer live inside the spoken
# turn — no cloud call, no full-agent handoff (the "ideal" local-first path the email
# tool proved). WRITES (sending mail/texts, creating reminders or tasks) deliberately
# live OUTSIDE this list: those escalate to a full HiveMatrix agent via
# resolve_escalation. Every tool is keyword-gated (see _tools_for) because the small
# model over-calls tools when they're always offered, stalling the spoken turn. ---
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_recent_emails",
            "description": "Read the user's recent INBOX EMAILS — returns the sender, subject, "
                           "date, and a content preview for each. Use for ANY email question: how "
                           "many, who the senders are, the subjects, or reading/summarizing a recent "
                           "email. Use limit=1 for 'the last/latest email', a larger limit to list several.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "How many recent emails (default 5, max 15). Use 1 for the latest email."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_imessages",
            "description": "Read the user's recent TEXT / iMESSAGE conversations from Messages — "
                           "returns who each message is from (or 'Me'), the time, and the text. Use "
                           "for any question about texts, iMessages, or who messaged them. Pass "
                           "'contact' (a name, phone, or email substring) to filter to one person, "
                           "e.g. 'the last text from Sarah'. Use limit=1 for the latest message.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "How many recent messages (default 5, max 15)."},
                    "contact": {"type": "string", "description": "Optional name/phone/email substring to filter to one person."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_calendar_events",
            "description": "Read TODAY'S calendar events — returns each event's title and start "
                           "time. Use for 'what's on my calendar', 'my schedule today', 'next "
                           "meeting', or 'am I free'. Reads only today.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "Max events to return (default 8, max 20)."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reminders",
            "description": "Read the user's OPEN (incomplete) reminders / to-dos — returns each "
                           "reminder's name and due date. Use for 'what's on my to-do list', 'what "
                           "reminders do I have'. This only READS; creating a reminder is handled elsewhere.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "Max reminders to return (default 10, max 20)."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_contact",
            "description": "Look up a person in the user's Contacts by name — returns their phone "
                           "numbers and email addresses. Use for 'what's John's number', 'my wife's "
                           "email'. Pass the person's name in 'name'.",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "The person's name to look up (required)."}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "Get the CURRENT local date and time. Use for 'what time is it', "
                           "'what's today's date', 'what day is it'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "CREATE a real Reminder on the user's devices (Apple Reminders). "
                           "Use when the user says 'remind me to X', 'set a reminder to X', "
                           "'add a reminder for X'. Pass the reminder text in 'name' (what to "
                           "be reminded of, without the words 'remind me to') and the user's "
                           "own words about when in 'due' (e.g. 'tomorrow at 5pm', 'in 20 "
                           "minutes', 'friday morning') — leave 'due' empty if no time was given.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "What to remind the user about (required)."},
                    "due": {"type": "string", "description": "When, in the user's words (optional): 'tomorrow 5pm', 'in 2 hours', 'monday at noon'."},
                },
                "required": ["name"],
            },
        },
    },
]


def _clamp(value, default: int, lo: int, hi: int) -> int:
    """Coerce a model-supplied limit to a sane integer in [lo, hi]."""
    try:
        return max(lo, min(int(value if value is not None else default), hi))
    except (TypeError, ValueError):
        return default


def _osascript(script: str, timeout: int = 12) -> tuple[bool, str]:
    """Run an AppleScript, BOUNDED so a slow app launch (or a spurious tool call the
    small model makes) can't stall the spoken turn for 30s. Returns (ok, text_or_err)."""
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return False, (r.stderr or "").strip()[:200]
        return True, re.sub(r"\n{3,}", "\n\n", r.stdout.strip())
    except subprocess.TimeoutExpired:
        return False, "the app did not respond in time"
    except Exception as e:
        traceback.print_exc()
        return False, str(e)[:200]


def _get_recent_emails(limit: int = 5) -> str:
    limit = _clamp(limit, 5, 1, 15)
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
    ok, out = _osascript(script)
    if not ok:
        return f"Could not read email: {out}"
    return out or "No recent emails in the inbox."


# Messages stores text in chat.db; reading it needs Full Disk Access for the host
# process. On current macOS the body lives in an `attributedBody` typedstream blob
# and the plain `text` column is NULL — so we read both and decode the blob when
# `text` is empty (see _attributed_body_to_text), else we'd return nothing.
_CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")


def _attributed_body_to_text(data: bytes | None) -> str | None:
    """Pull the message text out of a Messages `attributedBody` typedstream blob.
    The string follows the NSString class marker as a length-prefixed UTF-8 run
    (1-byte length, or 0x81/0x82 + 2/4-byte little-endian). Heuristic but robust on
    real chat.db rows; returns None for attachment-only messages (no text)."""
    if not data or b"NSString" not in data:
        return None
    try:
        t = data.split(b"NSString", 1)[1]
        plus = t.find(b"+")  # typedstream class marker just before the char run
        if plus == -1:
            return None
        t = t[plus + 1:]
        marker = t[0]
        if marker == 0x81:
            length = int.from_bytes(t[1:3], "little"); t = t[3:]
        elif marker == 0x82:
            length = int.from_bytes(t[1:5], "little"); t = t[5:]
        else:
            length = marker; t = t[1:]
        s = t[:length].decode("utf-8", "replace").replace("￼", "").strip()
        return s or None
    except Exception:
        traceback.print_exc()
        return None


def _get_recent_imessages(limit: int = 5, contact: str = "") -> str:
    limit = _clamp(limit, 5, 1, 15)
    if not os.path.exists(_CHAT_DB):
        return "The Messages database isn't available on this Mac."
    # Sanitize the contact filter (it comes from a transcript) to a safe LIKE on the
    # handle id (phone/email) — read-only DB, but keep the inlined string harmless.
    # Sanitized to [\w@.\s+-] above, so inlining into the LIKE is injection-safe (the
    # sqlite3 one-shot CLI can't bind `?` from argv). Read-only DB regardless.
    c = re.sub(r"[^\w@.\s+-]", "", (contact or "").strip())[:40]
    where = f"WHERE h.id LIKE '%{c}%'" if c else ""
    # date is ns since 2001-01-01; +978307200 converts to unix epoch. Over-fetch
    # (attachment-only rows decode to no text and get skipped) then trim to `limit`.
    sql = (
        "SELECT m.is_from_me AS me, COALESCE(h.id,'me') AS who, "
        "datetime(m.date/1000000000 + 978307200,'unixepoch','localtime') AS ts, "
        "m.text AS text, hex(m.attributedBody) AS body "
        f"FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID {where} "
        f"ORDER BY m.date DESC LIMIT {min(limit * 4, 60)}"
    )
    try:
        r = subprocess.run(["sqlite3", "-readonly", "-json", _CHAT_DB, sql],
                           capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        return "The Messages database did not respond in time."
    except FileNotFoundError:
        return "sqlite3 is not available to read Messages."
    except Exception as e:
        traceback.print_exc()
        return f"Could not read messages: {e}"
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        if "authoriz" in err.lower() or "unable to open" in err.lower():
            return "I don't have permission to read Messages — grant the app Full Disk Access in System Settings."
        return f"Could not read messages: {err[:160]}"
    try:
        rows = json.loads(r.stdout.strip() or "[]")
    except (ValueError, json.JSONDecodeError):
        return "Could not parse the Messages results."
    lines = []
    for row in rows:
        text = (row.get("text") or "").strip()
        if not text:
            body = row.get("body") or ""
            text = _attributed_body_to_text(bytes.fromhex(body)) if body else None
        if not text:
            continue  # attachment-only / undecodable — skip
        text = text.replace("\n", " ")
        if len(text) > 400:
            text = text[:400] + "..."
        who = "Me" if row.get("me") == 1 else (row.get("who") or "Unknown")
        lines.append(f"{who} ({row.get('ts', '')}): {text}")
        if len(lines) >= limit:
            break
    if not lines:
        return f"No recent messages{(' from ' + contact) if contact else ''}."
    return "\n".join(lines)


def _get_calendar_events(limit: int = 8) -> str:
    limit = _clamp(limit, 8, 1, 20)
    # Scope to today's window only — an unbounded Calendar query is slow; this keeps
    # the osascript within the spoken-turn budget.
    script = (
        'set d0 to (current date)\n'
        'set hours of d0 to 0\n'
        'set minutes of d0 to 0\n'
        'set seconds of d0 to 0\n'
        'set d1 to d0 + (1 * days)\n'
        'tell application "Calendar"\n'
        '  set out to ""\n'
        '  set n to 0\n'
        '  repeat with c in calendars\n'
        '    set evs to (every event of c whose start date >= d0 and start date < d1)\n'
        '    repeat with e in evs\n'
        f'      if n < {limit} then\n'
        '        set out to out & (summary of e) & " — " & (start date of e as string) & linefeed\n'
        '        set n to n + 1\n'
        '      end if\n'
        '    end repeat\n'
        '  end repeat\n'
        '  return out\n'
        'end tell'
    )
    ok, out = _osascript(script)
    if not ok:
        return f"Could not read the calendar: {out}"
    return out or "Nothing on the calendar today."


def _get_reminders(limit: int = 10) -> str:
    limit = _clamp(limit, 10, 1, 20)
    script = (
        'tell application "Reminders"\n'
        '  set out to ""\n'
        '  set rs to (reminders whose completed is false)\n'
        f'  set lim to {limit}\n'
        '  if (count of rs) < lim then set lim to (count of rs)\n'
        '  repeat with i from 1 to lim\n'
        '    set r to item i of rs\n'
        '    set out to out & "- " & (name of r)\n'
        '    try\n'
        '      if (due date of r) is not missing value then set out to out & " (due " & ((due date of r) as string) & ")"\n'
        '    end try\n'
        '    set out to out & linefeed\n'
        '  end repeat\n'
        '  return out\n'
        'end tell'
    )
    ok, out = _osascript(script)
    if not ok:
        return f"Could not read reminders: {out}"
    return out or "No open reminders."


def _get_contact(name: str = "") -> str:
    q = re.sub(r'["\\]', "", (name or "").strip())[:60]
    if not q:
        return "No name was given to look up."
    script = (
        'tell application "Contacts"\n'
        f'  set ppl to (every person whose name contains "{q}")\n'
        '  set out to ""\n'
        '  set lim to (count of ppl)\n'
        '  if lim > 5 then set lim to 5\n'
        '  repeat with i from 1 to lim\n'
        '    set p to item i of ppl\n'
        '    set out to out & (name of p) & linefeed\n'
        '    repeat with ph in phones of p\n'
        '      set out to out & "  phone: " & (value of ph) & linefeed\n'
        '    end repeat\n'
        '    repeat with em in emails of p\n'
        '      set out to out & "  email: " & (value of em) & linefeed\n'
        '    end repeat\n'
        '  end repeat\n'
        '  return out\n'
        'end tell'
    )
    ok, out = _osascript(script)
    if not ok:
        return f"Could not look up contacts: {out}"
    return out or f"No contact found matching {q}."


def _get_datetime() -> str:
    from datetime import datetime
    now = datetime.now().astimezone()
    return now.strftime("It is %A, %B %-d, %Y, %-I:%M %p %Z.")


# --- Reminder creation: the one WRITE that runs live in the spoken turn. It's
# local, instant, low-risk, and exactly what the user asked for — detouring
# "remind me to call mom at 5" through a background agent task was the old,
# slow path. Due-date parsing is deterministic Python (the small model only
# relays the user's own words); the AppleScript sets date components explicitly
# so nothing depends on locale date-string parsing. ---

_WEEKDAY_IDX = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
                "friday": 4, "saturday": 5, "sunday": 6}
_DAYPART_HOUR = {"morning": 9, "noon": 12, "afternoon": 15, "evening": 18,
                 "tonight": 20, "night": 20, "midnight": 0}


def _parse_due(text: str, now=None):
    """Parse a spoken due phrase ('tomorrow at 5pm', 'in 20 minutes', 'friday
    morning', '5:30 pm') into a local datetime, or None if nothing parses.
    Deterministic and forgiving — unknown words are ignored, not errors."""
    from datetime import datetime, timedelta
    t = (text or "").strip().lower()
    if not t:
        return None
    now = now or datetime.now()

    # "in N minutes/hours/days/weeks" — relative wins outright.
    m = re.search(r"\bin\s+(\d+|a|an)\s+(minute|min|hour|hr|day|week)s?\b", t)
    if m:
        n = 1 if m.group(1) in ("a", "an") else int(m.group(1))
        unit = m.group(2)
        delta = {"minute": timedelta(minutes=n), "min": timedelta(minutes=n),
                 "hour": timedelta(hours=n), "hr": timedelta(hours=n),
                 "day": timedelta(days=n), "week": timedelta(weeks=n)}[unit]
        return now + delta

    # Day: today / tonight / tomorrow / a weekday name. Default = today.
    day = now
    explicit_day = False
    if re.search(r"\btomorrow\b", t):
        day = now + timedelta(days=1)
        explicit_day = True
    else:
        for name, idx in _WEEKDAY_IDX.items():
            if re.search(rf"\b{name}\b", t):
                ahead = (idx - now.weekday()) % 7 or 7  # "friday" = the NEXT friday
                day = now + timedelta(days=ahead)
                explicit_day = True
                break
        if not explicit_day and re.search(r"\btoday\b|\btonight\b|\bthis\b", t):
            explicit_day = True

    # Time: "at 5", "5:30 pm", "17:45", noon/midnight/morning/evening...
    hour, minute = None, 0
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b", t)
    if m:
        h = int(m.group(1))
        if 0 <= h <= 23:
            minute = int(m.group(2) or 0)
            ampm = (m.group(3) or "").replace(".", "")
            if ampm == "pm" and h < 12:
                h += 12
            elif ampm == "am" and h == 12:
                h = 0
            elif not ampm and h <= 7:
                h += 12  # bare "at 5" almost always means 5 PM in speech
            hour = h
    if hour is None:
        for word, h in _DAYPART_HOUR.items():
            if re.search(rf"\b{word}\b", t):
                hour = h
                break
    if hour is None and not explicit_day:
        return None  # nothing usable ("someday", "later")
    if hour is None:
        hour = 9  # a day with no time → 9 AM

    due = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due <= now and not explicit_day:
        due += timedelta(days=1)  # "at 5" said at 6 PM → tomorrow 5 PM
    return due


def _create_reminder(name: str = "", due: str = "") -> str:
    clean = re.sub(r'["\\]', "", (name or "").strip())[:120]
    if not clean:
        return "No reminder text was given."
    when = _parse_due(due)
    lines = []
    if when:
        lines += [
            "set d to current date",
            f"set year of d to {when.year}",
            f"set month of d to {when.month}",
            f"set day of d to {when.day}",
            f"set hours of d to {when.hour}",
            f"set minutes of d to {when.minute}",
            "set seconds of d to 0",
            'tell application "Reminders" to make new reminder with properties '
            f'{{name:"{clean}", due date:d, remind me date:d}}',
        ]
    else:
        lines.append(
            f'tell application "Reminders" to make new reminder with properties {{name:"{clean}"}}'
        )
    ok, out = _osascript("\n".join(lines))
    if not ok:
        return f"Could not set the reminder: {out}"
    if when:
        return f"Reminder set: \"{clean}\" for {when.strftime('%A %B %-d at %-I:%M %p')}."
    return f"Reminder set: \"{clean}\" (no due time)."


def _run_tool(name: str, args: dict) -> str:
    if name == "get_recent_emails":
        return _get_recent_emails(args.get("limit", 5))
    if name == "get_recent_imessages":
        return _get_recent_imessages(args.get("limit", 5), args.get("contact", ""))
    if name == "get_calendar_events":
        return _get_calendar_events(args.get("limit", 8))
    if name == "get_reminders":
        return _get_reminders(args.get("limit", 10))
    if name == "get_contact":
        return _get_contact(args.get("name", ""))
    if name == "get_datetime":
        return _get_datetime()
    if name == "create_reminder":
        return _create_reminder(args.get("name", ""), args.get("due", ""))
    return f"Unknown tool: {name}"


# Deterministic gates: only OFFER a tool when the user actually mentions that thing.
# The small local model can't reliably decide on its own — at any temperature it
# over-fires tools on unrelated questions 50–75% of the time, stalling the spoken
# turn. A keyword pre-check is 100% predictable, and offering only the matched subset
# (not all six tools) keeps the model focused. Each pattern is scoped so the gates
# don't overlap onto unrelated asks (weather/math/news match none of them).
#
# Email vs. texts are split deliberately: "messages/texted/iMessage" route to the
# Messages tool, "mail/inbox/senders" to the email tool — so "the last text from
# Sarah" no longer mis-reads the email inbox (the old combined gate's bug).
_EMAIL_RE = re.compile(
    r"\b(e-?mails?|inbox|mailbox|mail|senders?|correspondence|"
    r"who\s+(?:e-?mailed|wrote)(?:\s+me)?)\b",
    re.I,
)
_IMESSAGE_RE = re.compile(
    r"\b(texts?|texted|texting|i-?messages?|sms|messages?|"
    r"who\s+(?:messaged|texted)(?:\s+me)?|(?:message|text)\s+from)\b",
    re.I,
)
_CALENDAR_RE = re.compile(
    r"\b(calendar|schedule|agenda|appointments?|meetings?|"
    r"am\s+i\s+(?:free|busy)|what'?s\s+(?:on\s+)?(?:my\s+)?(?:day|today)|"
    r"next\s+(?:meeting|appointment|event))\b",
    re.I,
)
_REMINDER_RE = re.compile(
    r"\b(reminders?|to-?dos?|to-?do\s+list|"
    r"(?:tasks?|things?)\s+(?:do\s+i|i\s+have|i\s+need)|"
    r"what\s+do\s+i\s+(?:have|need)\s+to\s+do)\b",
    re.I,
)
_CONTACT_RE = re.compile(
    r"\b(phone\s+number|number\s+for|contact\s+(?:info|details|for|number)|"
    r"what'?s\s+\w+'?s?\s+(?:number|email|phone)|"
    r"email\s+(?:address\s+)?(?:for|of))\b",
    re.I,
)
_DATETIME_RE = re.compile(
    r"\b(what\s+time|what'?s\s+the\s+time|the\s+time\s+(?:right\s+)?now|"
    r"today'?s\s+date|what'?s\s+(?:the\s+|today'?s\s+)?date|what\s+day\s+is|"
    r"current\s+(?:time|date))\b",
    re.I,
)
# CREATE (not read) — "remind me to X", "set/add a reminder". Distinct from
# _REMINDER_RE (which reads the list) so "what are my reminders" never offers
# the write tool and "remind me to call mom" never merely reads the list.
_REMINDER_CREATE_RE = re.compile(
    r"\b(remind\s+me|(?:set|add|create|make)\s+(?:a\s+|another\s+)?reminder)\b",
    re.I,
)

# Gate → tool name. Order is the offer order when several match (rare).
# create_reminder is FIRST so "remind me to email Bob at 4" offers the write
# tool ahead of any read the sentence's nouns also happen to gate.
_TOOL_GATES = [
    ("create_reminder", _REMINDER_CREATE_RE),
    ("get_datetime", _DATETIME_RE),
    ("get_recent_emails", _EMAIL_RE),
    ("get_recent_imessages", _IMESSAGE_RE),
    ("get_calendar_events", _CALENDAR_RE),
    ("get_reminders", _REMINDER_RE),
    ("get_contact", _CONTACT_RE),
]
_TOOL_BY_NAME = {t["function"]["name"]: t for t in TOOLS}


def _tools_for(text: str) -> list[dict]:
    """The subset of TOOLS whose keyword gate matches the transcript (possibly empty)."""
    t = text or ""
    return [_TOOL_BY_NAME[name] for name, rx in _TOOL_GATES if rx.search(t)]


def _mentions_email(text: str) -> bool:  # retained for back-compat / external callers
    return bool(_EMAIL_RE.search(text or ""))


# --- Structured actions: deterministic, client-renderable follow-ups extracted
# from a turn (never model-generated). Today: dial/text buttons for any phone
# number a contact lookup surfaced, so "what's John's number" on the iPhone or
# Watch answers with a tappable CALL button, not just spoken digits. ---

_PHONE_RE = re.compile(r"(\+?1?[\s.\-(]*\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}|\+\d{7,15})")


def _normalize_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw or "")
    if digits.startswith("+"):
        return digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits  # bare US-format number from Contacts
    return digits


def extract_actions(tool_runs: list[dict] | None, reply: str = "") -> list[dict]:
    """Build the turn's structured actions. Contact-lookup output yields
    dial + sms actions labeled with the person's name; phone numbers the model
    spoke in the reply (rare) yield unlabeled dial actions. Deduped, capped."""
    actions: list[dict] = []
    seen: set[str] = set()

    def add(kind: str, label: str, number: str):
        num = _normalize_phone(number)
        if not num or len(re.sub(r"\D", "", num)) < 7 or (kind, num) in seen:
            return
        seen.add((kind, num))
        actions.append({"type": kind, "label": label, "number": num})

    for run in tool_runs or []:
        if run.get("name") != "get_contact":
            continue
        person = ""
        for line in str(run.get("output", "")).splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if not line.startswith(" "):  # contact-name row (phones/emails are indented)
                person = stripped
            elif stripped.lower().startswith("phone:"):
                num = stripped.split(":", 1)[1].strip()
                who = person or "them"
                add("dial", f"Call {who}", num)
                add("sms", f"Text {who}", num)

    for m in _PHONE_RE.finditer(reply or ""):
        add("dial", "Call this number", m.group(0))

    return actions[:6]


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
        """Back-compat wrapper — spoken text only. See respond_with_tools_meta."""
        return self.respond_with_tools_meta(user_text, system, history)[0]

    def respond_with_tools_meta(self, user_text: str, system: str = SYSTEM_PROMPT,
                                history: list[dict] | None = None) -> tuple[str, list[dict]]:
        """Like respond(), but when the user asks about a local read (email, texts,
        calendar, reminders, contacts, the time) — or a live reminder write — the
        model may call the matching tool first, then give a spoken-style summary.
        Only the gated subset of tools is offered (see _tools_for) — every other
        question goes straight to a plain reply, so no spurious tool stalls.
        Outbound sends are skipped here: they can't run live and escalate to a
        full agent (resolve_escalation), so don't waste a read.

        Returns (spoken_text, tool_runs) where tool_runs is
        [{"name", "args", "output"}] for every tool executed this turn — the
        caller uses it for escalation decisions and structured actions
        (extract_actions), so a contact lookup can become a tap-to-dial button."""
        if wants_outbound(user_text):
            return self.respond(user_text, system, history), []
        tools = _tools_for(user_text)
        if not tools:
            return self.respond(user_text, system, history), []
        messages: list[dict] = [{"role": "system", "content": system}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_text})
        try:
            first = self.client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=SPOKEN_MAX_TOKENS, temperature=0.4,
                tools=tools, tool_choice="auto", extra_body=THINKING_OFF,
            )
        except Exception:
            traceback.print_exc()
            return self.respond(user_text, system, history), []
        msg = first.choices[0].message
        calls = getattr(msg, "tool_calls", None)
        if not calls:
            # No tool needed. If the model produced spoken content, use it; if it
            # came back empty (reasoning ate the budget, or a stray empty turn),
            # fall back to a plain reply so the user never hears silence.
            text = _THINK_RE.sub("", msg.content or "").strip()
            return (text or self.respond(user_text, system, history)), []
        messages.append({
            "role": "assistant", "content": msg.content or "",
            "tool_calls": [{"id": c.id, "type": "function",
                            "function": {"name": c.function.name, "arguments": c.function.arguments}}
                           for c in calls],
        })
        tool_runs: list[dict] = []
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except (TypeError, ValueError, json.JSONDecodeError):
                args = {}
            output = _run_tool(c.function.name, args)
            tool_runs.append({"name": c.function.name, "args": args, "output": output})
            messages.append({"role": "tool", "tool_call_id": c.id, "content": output})
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
        return text, tool_runs

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
