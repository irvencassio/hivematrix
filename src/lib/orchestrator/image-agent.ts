// Image agent — Nano Banana (cloud) / mflux (local) image generation (W5.1).
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type { AgentProcess, AgentEventHandler } from "./subprocess";
import { generateImage } from "./image-gen";

export function spawnImageAgent(
  taskId: string,
  description: string,
  projectPath: string,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  _provider: unknown,
  model: string,
): AgentProcess {
  const prompt = description.trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Generation runs async; the returned "process" is an already-detached stub
  // (image gen isn't a long-running child). Events + exit are emitted on finish.
  onEvent(taskId, { type: "log", content: `[image] generating with ${model}…` });
  void generateImage(taskId, prompt, stamp)
    .then((r) => {
      if (r.ok) {
        onEvent(taskId, { type: "log", content: `[image] ${r.backend} → ${r.path}` });
        onExit(taskId, 0, null);
      } else {
        onEvent(taskId, { type: "error", content: `[image] generation failed: ${r.detail}` });
        onExit(taskId, 1, null);
      }
    })
    .catch((err) => {
      onEvent(taskId, { type: "error", content: `[image] ${err instanceof Error ? err.message : String(err)}` });
      onExit(taskId, 1, null);
    });

  const dead = new EventEmitter() as unknown as ChildProcess;
  return { proc: dead, pid: -1, taskId, projectPath, startedAt: new Date(), textBuffer: "", modelsUsed: [model] };
}
