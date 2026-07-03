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

export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  DWARFSTAR_DEEPSEEK_FLASH_PRESET,
];

export function localPresetForModel(modelId: string): LocalModelPreset | null {
  return LOCAL_MODEL_PRESETS.find((preset) =>
    preset.modelId === modelId || modelId === DEEPSEEK_FLASH_GGUF_NAME
  ) ?? null;
}
