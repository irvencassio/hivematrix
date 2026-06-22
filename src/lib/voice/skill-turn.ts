/**
 * Voice skill-picker override for the push-to-talk turn. After the worker returns
 * the STT transcript, if the utterance is a skill query ("what skills do I have /
 * find a skill for X / use the Y skill") we answer DETERMINISTICALLY — re-synthesize
 * the precise spoken reply and return it in place of the LLM's. Wired into
 * /voice/turn so console Talk AND iOS push-to-talk both get it (no sidecar change).
 *
 * The detection + reply text are the pure, tested core (skill-intent.ts); this is
 * the thin IO glue (read the library, synth the reply).
 */

import { readFileSync } from "fs";
import { detectSkillIntent, buildSkillVoiceReply } from "./skill-intent";
import { synthesizeSpeech } from "./tts";
import { listSkills } from "@/lib/skills/store";

export interface SkillTurnOverride {
  reply: string;
  audioBase64: string;
  skill: { action: string | null; name: string | null; matches: string[] };
}

/** Returns a deterministic skill answer for a transcript, or null to fall through
 * to the normal LLM reply. Never throws. */
export async function skillTurnOverride(transcript: string): Promise<SkillTurnOverride | null> {
  const intent = detectSkillIntent(transcript || "");
  if (intent.kind === "none") return null;
  let sk;
  try { sk = buildSkillVoiceReply(intent, await listSkills()); } catch { return null; }
  if (!sk.handled) return null;

  let audioBase64 = "";
  try {
    const tts = await synthesizeSpeech(sk.reply);
    audioBase64 = readFileSync(tts.path).toString("base64");
  } catch { /* speak-less fallback: client shows the text reply */ }

  return {
    reply: sk.reply,
    audioBase64,
    skill: { action: sk.action ?? null, name: sk.name ?? null, matches: sk.matches },
  };
}
