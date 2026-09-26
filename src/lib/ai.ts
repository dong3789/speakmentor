// Shared config for OpenAI-compatible APIs.
// Works with OpenAI, Groq, OpenRouter, Moonshot Kimi, etc.
// Set OPENAI_BASE_URL if you use a non-OpenAI provider.

export function aiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  return { apiKey, baseUrl };
}

export function hasAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Local stacks run STT / LLM / TTS on different ports
// (e.g. whisper.cpp :8080, LM Studio :1234, kokoro :8880).
// Each falls back to the shared OpenAI vars, so one OpenAI key
// still works with zero extra config.
export function sttConfig() {
  const apiKey = process.env.STT_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = (process.env.STT_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  return { apiKey, baseUrl };
}

export function ttsConfig() {
  const apiKey = process.env.TTS_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = (process.env.TTS_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  return { apiKey, baseUrl };
}
