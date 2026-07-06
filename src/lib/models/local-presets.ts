export type LocalPresetProvider = "mlx";

export interface LocalModelPreset {
  id: string;
  provider: LocalPresetProvider;
  modelId: string;
  name: string;
  endpoint: string;
  note: string;
}

export const QWEN36_35B_API_MODEL_ID = "mlx-community/Qwen3.6-35B-A3B-8bit";
export const RAPID_MLX_QWEN_ENDPOINT = "http://127.0.0.1:8090/v1";

// Standard Qwen option for local fast-agent planning.
// Bake-off 2026-07-04 (tools/model-bench): 12/12 correctness, ~82 tok/s,
// 2/2 on the two-step tool-calling task via rapid-mlx.
export const RAPID_MLX_QWEN36_35B_PRESET: LocalModelPreset = {
  id: "rapid-mlx-qwen36-35b",
  provider: "mlx",
  modelId: QWEN36_35B_API_MODEL_ID,
  name: "Qwen3.6-35B-A3B (Rapid-MLX)",
  endpoint: RAPID_MLX_QWEN_ENDPOINT,
  note: "Rapid-MLX server; fits 48GB+ machines at 8-bit (use 4-bit below 48GB)",
};

export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  RAPID_MLX_QWEN36_35B_PRESET,
];

export function localPresetForModel(modelId: string): LocalModelPreset | null {
  return LOCAL_MODEL_PRESETS.find((preset) =>
    preset.modelId === modelId
  ) ?? null;
}
