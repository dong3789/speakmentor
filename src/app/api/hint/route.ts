import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getGamification, spendSeeds } from "@/lib/store";
import { aiConfig, hasAIKey } from "@/lib/ai";

export const runtime = "nodejs";

const COSTS = { korean: 5, example: 3 } as const;

// POST /api/hint  { kind: "korean" | "example", question, level, samples? }
// Learning hints bought with 🌻 seeds (the idle currency). Seeds are spent
// only after a successful generation; balance is checked before generating.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "example" ? "example" : "korean";
  const question = String(body.question || "").slice(0, 300);
  const level = String(body.level || "A2");
  const samples: string[] = Array.isArray(body.samples) ? body.samples.map(String).slice(0, 2) : [];
  const cost = COSTS[kind];

  if (!hasAIKey()) {
    return NextResponse.json({ error: "AI 키가 설정되지 않았어요" }, { status: 400 });
  }
  const balance = await getGamification(user.id);
  if (balance.seeds < cost) {
    return NextResponse.json(
      { error: `씨앗이 부족해요 🌻 (${balance.seeds}/${cost}) — 시간이 지나면 다시 모여요` },
      { status: 402 },
    );
  }

  try {
    const { apiKey, baseUrl } = aiConfig();
    const system =
      kind === "korean"
        ? "You help a Korean adult learner answer an English conversation question. Reply with 2-3 short Korean keyword ideas they could mention in their answer. Output ONLY the keywords separated by commas. No English, no explanation."
        : `Give ONE example English answer to the question, suitable for a ${level} CEFR learner. One short spoken sentence (max 12 words). It must be DIFFERENT from these existing examples: ${samples.join(" / ") || "(none)"}. Output ONLY the sentence.`;
    const userMsg = kind === "korean" ? `Question: ${question}` : `Question: ${question}\nLevel: ${level}`;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.TUTOR_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: 0.8,
        max_tokens: 2000,
        reasoning_effort: process.env.TUTOR_REASONING || "low",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "힌트 생성에 실패했어요." }, { status: 502 });
    }
    const data = await res.json();
    const content = (data?.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    if (!content) {
      return NextResponse.json({ error: "힌트 생성에 실패했어요." }, { status: 502 });
    }

    await spendSeeds(user.id, cost);
    const game = await getGamification(user.id);
    return NextResponse.json({ content, seeds: game.seeds, cost });
  } catch {
    return NextResponse.json({ error: "힌트 생성에 실패했어요." }, { status: 502 });
  }
}
