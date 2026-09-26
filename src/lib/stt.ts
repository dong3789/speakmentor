import { sttConfig } from "./ai";

// STT for the record-then-upload fallback (iOS Safari, Firefox, no-SR browsers).
// Two backends:
//  - Gemini native (multimodal generateContent) when the key is a Gemini key
//  - OpenAI-compatible /audio/transcriptions (Whisper) otherwise

function usingGemini(): boolean {
  if (process.env.STT_PROVIDER === "whisper-cpp") return false;
  const base = process.env.STT_BASE_URL || process.env.OPENAI_BASE_URL || "";
  return base.includes("generativelanguage") || process.env.STT_PROVIDER === "gemini";
}

function usingWhisperCpp(): boolean {
  return process.env.STT_PROVIDER === "whisper-cpp";
}

// whisper.cpp server (brew whisper-server): POST {base}/inference with
// response_format=text -> plain-text transcript. Handles mp3/m4a/webm via
// its --convert flag (ffmpeg). Free, local, ~0.4s on the Mac mini.
async function transcribeWithWhisperCpp(audio: Blob): Promise<string> {
  const base = (process.env.STT_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const form = new FormData();
  form.append("file", audio, "turn.audio");
  form.append("response_format", "text");
  const res = await fetch(`${base}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`STT failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.text()).trim();
}

function blobToBase64(b: ArrayBuffer): string {
  return Buffer.from(b).toString("base64");
}

// English speech in -> transcript text out. Gemini handles aac/m4a (iOS
// MediaRecorder), webm/opus, mp3, wav.
async function transcribeWithGemini(audio: Blob): Promise<string> {
  const { apiKey } = sttConfig();
  const model = process.env.STT_MODEL || process.env.TUTOR_MODEL || "gemini-3.8-flash";
  const mime = audio.type || "audio/webm";
  const data = blobToBase64(await audio.arrayBuffer());

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Transcribe the spoken English in this recording exactly as said. " +
                  "Output ONLY the transcript text, no commentary, no quotes. " +
                  "If there is no intelligible speech, output exactly: (no speech detected)",
              },
              { inline_data: { mime_type: mime, data } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 2000 },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`STT failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data2 = await res.json();
  const parts = data2?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return text;
}

async function transcribeWithOpenAI(audio: Blob): Promise<string> {
  const { apiKey, baseUrl } = sttConfig();
  const form = new FormData();
  form.append("file", audio, "turn.webm");
  form.append("model", process.env.STT_MODEL || "whisper-1");
  form.append("language", "en"); // the user practices English

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`STT failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.text ?? "").trim();
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  if (usingWhisperCpp()) return transcribeWithWhisperCpp(audio);
  if (usingGemini()) return transcribeWithGemini(audio);
  return transcribeWithOpenAI(audio);
}
