"""LLM turn for the VoiceBee sidecar — calls HiveMatrix's LOCAL model over its
OpenAI-compatible endpoint (the same local server the daemon routes to). All
config is env-driven so it tracks whatever the operator has serving locally:

    HIVE_LLM_BASE_URL  (default http://127.0.0.1:11434/v1)
    HIVE_LLM_MODEL     (default "qwen")
    HIVE_LLM_API_KEY   (default "local" — local servers ignore it)

Keeping the loop local honors the Q12 "local-first" posture; no cloud call.
"""
import os
import re

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

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)

# Qwen 3.6 is a reasoning model. In LM Studio its reasoning lands in a separate
# `reasoning_content` field and the spoken answer in `content` — but the reasoning
# still costs tokens + latency, so we (a) budget enough tokens for the answer to
# survive the reasoning, and (b) try to disable thinking via the chat-template
# flag. NOTE: with the current LM Studio build the flag is not honored, so for
# sub-second live voice the operator should turn reasoning OFF in LM Studio's
# model settings (or load a non-thinking model). Latency, not code, is the gate.
THINKING_OFF = {"chat_template_kwargs": {"enable_thinking": False}}


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
            model=self.model, messages=messages, max_tokens=512, temperature=0.4,
            extra_body=THINKING_OFF,
        )
        content = resp.choices[0].message.content or ""
        # Reasoning (if any) is in message.reasoning_content; ignore it for TTS.
        # Defensively strip any inline <think> block too.
        return _THINK_RE.sub("", content).strip()

    def respond_stream(self, user_text: str, system: str = SYSTEM_PROMPT,
                       history: list[dict] | None = None):
        """Yield reply text deltas as they stream — feed straight into iter_sentences."""
        messages = [{"role": "system", "content": system}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_text})
        stream = self.client.chat.completions.create(
            model=self.model, messages=messages, max_tokens=512, temperature=0.4,
            extra_body=THINKING_OFF, stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            text = getattr(chunk.choices[0].delta, "content", None) or ""
            if text:
                yield text
