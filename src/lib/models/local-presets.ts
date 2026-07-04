export type LocalPresetProvider = "mlx" | "dwarfstar";

export interface LocalModelPreset {
  id: string;
  provider: LocalPresetProvider;
  modelId: string;
  name: string;
  endpoint: string;
  note: string;
}

export const DEEPSEEK_FLASH_API_MODEL_ID = "deepseek-v4-flash";
export const DEEPSEEK_FLASH_GGUF_NAME = "DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf";
export const DWARFSTAR_DEEPSEEK_ENDPOINT = "http://127.0.0.1:8000/v1";

export const DWARFSTAR_DEEPSEEK_FLASH_PRESET: LocalModelPreset = {
  id: "dwarfstar-deepseek-flash",
  provider: "dwarfstar",
  modelId: DEEPSEEK_FLASH_API_MODEL_ID,
  name: "Dwarf Star DeepSeek V4 Flash",
  endpoint: DWARFSTAR_DEEPSEEK_ENDPOINT,
  note: `Dwarf Star agentic server with memory, optimized for ${DEEPSEEK_FLASH_GGUF_NAME}`,
};

export const QWEN36_35B_API_MODEL_ID = "mlx-community/Qwen3.6-35B-A3B-8bit";
export const RAPID_MLX_QWEN_ENDPOINT = "http://127.0.0.1:8090/v1";

// Second standard option, for machines without the ~128GB DeepSeek needs.
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
  DWARFSTAR_DEEPSEEK_FLASH_PRESET,
  RAPID_MLX_QWEN36_35B_PRESET,
];

export function localPresetForModel(modelId: string): LocalModelPreset | null {
  return LOCAL_MODEL_PRESETS.find((preset) =>
    preset.modelId === modelId || modelId === DEEPSEEK_FLASH_GGUF_NAME
  ) ?? null;
}
