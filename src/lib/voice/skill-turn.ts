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
import { listSkills, readSkill } from "@/lib/skills/store";
import { applySkillInput, type Skill, type SkillIndexEntry } from "@/lib/skills/contracts";
import { runScriptSkill, type RunScriptResult } from "@/lib/skills/run-script";
import { Task, generateId } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";

export interface SkillTurnOverride {
  reply: string;
  audioBase64: string;
  skill: { action: string | null; name: string | null; matches: string[]; taskId?: string; runId?: string };
}

export interface SkillTurnDeps {
  listSkills?: () => Promise<SkillIndexEntry[]>;
  readSkill?: (name: string) => Promise<Skill | null>;
  synthesize?: (text: string) => Promise<string>;
  createInstructionTask?: (payload: Record<string, unknown>) => Promise<{ _id: string }>;
  runScriptSkill?: (skill: Skill, input: string) => RunScriptResult;
}

/** Returns a deterministic skill answer for a transcript, or null to fall through
 * to the normal LLM reply. Never throws. */
export async function skillTurnOverride(transcript: string, deps: SkillTurnDeps = {}): Promise<SkillTurnOverride | null> {
  const intent = detectSkillIntent(transcript || "");
  if (intent.kind === "none") return null;
  let sk;
  try { sk = buildSkillVoiceReply(intent, await (deps.listSkills ?? listSkills)()); } catch { return null; }
  if (!sk.handled) return null;

  let run: { reply: string; taskId?: string; runId?: string } | null = null;
  if (sk.action === "use" && sk.name) {
    run = await launchResolvedSkill(sk.name, transcript, deps);
    if (run) sk.reply = run.reply;
  }

  let audioBase64 = "";
  try {
    const path = deps.synthesize ? await deps.synthesize(sk.reply) : (await synthesizeSpeech(sk.reply)).path;
    audioBase64 = path ? readFileSync(path).toString("base64") : "";
  } catch { /* speak-less fallback: client shows the text reply */ }

  return {
    reply: sk.reply,
    audioBase64,
    skill: { action: sk.action ?? null, name: sk.name ?? null, matches: sk.matches, taskId: run?.taskId, runId: run?.runId },
  };
}

async function launchResolvedSkill(name: string, transcript: string, deps: SkillTurnDeps): Promise<{ reply: string; taskId?: string; runId?: string } | null> {
  const skill = await (deps.readSkill ?? readSkill)(name);
  if (!skill) return { reply: `I found the ${speakSkillName(name)} skill, but couldn't load it to run.` };

  if (skill.kind === "script") {
    const r = (deps.runScriptSkill ?? ((s, input) => runScriptSkill(s, input, { cwd: process.cwd() })))(skill, transcript);
    if (!r.ok || !r.run) return { reply: `I found the ${speakSkillName(skill.name)} skill, but couldn't start it: ${r.error ?? "unknown error"}.` };
    return { reply: `Started the ${speakSkillName(skill.name)} script skill.`, runId: r.run.runId };
  }

  const payload = {
    _id: generateId(),
    title: `[skill] ${skill.name}`,
    description: `Apply this skill:\n\n${applySkillInput(skill.body, transcript)}`,
    project: "ops",
    projectPath: process.cwd(),
    profile: "developer",
    status: "backlog",
    executor: "agent",
    source: "skill",
    output: { skill: skill.name, via: "voice" },
  };
  const task = await (deps.createInstructionTask ?? ((p) => Task.create(p)))(payload);
  broadcast({ type: "tasks:created", taskId: task._id });
  return { reply: `Started the ${speakSkillName(skill.name)} skill as a task.`, taskId: task._id };
}

function speakSkillName(name: string): string {
  return name.replace(/-/g, " ").trim();
}
