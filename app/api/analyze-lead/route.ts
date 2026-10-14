import { NextResponse } from "next/server";
import { getServerSupabase, type Lead } from "@/lib/supabase";

type AnalyzeBody = {
  leadId?: string;
  notes?: string;
};

type AnalysisResult = {
  summary: string;
  actionPlan: string[];
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI 回傳格式不是有效 JSON。");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeAnalysis(raw: unknown): AnalysisResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI 分析結果格式不正確。");
  }

  const record = raw as Record<string, unknown>;
  const summary =
    (typeof record.summary === "string" && record.summary) ||
    (typeof record.Summary === "string" && record.Summary) ||
    "";

  const planSource =
    record.actionPlan ?? record.action_plan ?? record["Action Plan"];

  let actionPlan: string[] = [];
  if (Array.isArray(planSource)) {
    actionPlan = planSource.filter((item): item is string => typeof item === "string");
  } else if (typeof planSource === "string" && planSource.trim()) {
    actionPlan = planSource
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
      .filter(Boolean);
  }

  if (!summary.trim()) {
    throw new Error("AI 未產出核心痛點摘要。");
  }

  return {
    summary: summary.trim(),
    actionPlan: actionPlan.length > 0 ? actionPlan : ["與客戶確認需求後再約下一次會議。"],
  };
}

async function analyzeWithClaude(notes: string): Promise<AnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("missing-anthropic");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 1024,
      system:
        "你是 B2B CRM 業務助理。請只回傳 JSON，不要 markdown。格式：{\"summary\":\"...\",\"actionPlan\":[\"...\"]}",
      messages: [
        {
          role: "user",
          content: `請根據以下客戶筆記，整理核心痛點（summary，2-4 句）與建議下一步（actionPlan，3-5 條可執行事項）。用繁體中文。\n\n${notes}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API 失敗（${response.status}）：${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = payload.content?.map((part) => part.text ?? "").join("\n") ?? "";
  return normalizeAnalysis(extractJsonObject(text));
}

async function analyzeWithOpenAI(notes: string): Promise<AnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("missing-openai");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是 B2B CRM 業務助理。請只回傳 JSON：{\"summary\":\"...\",\"actionPlan\":[\"...\"]}",
        },
        {
          role: "user",
          content: `請根據以下客戶筆記，整理核心痛點（summary，2-4 句）與建議下一步（actionPlan，3-5 條可執行事項）。用繁體中文。\n\n${notes}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API 失敗（${response.status}）：${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  return normalizeAnalysis(extractJsonObject(text));
}

async function runAnalysis(notes: string): Promise<AnalysisResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    return analyzeWithClaude(notes);
  }
  if (process.env.OPENAI_API_KEY) {
    return analyzeWithOpenAI(notes);
  }
  throw new Error("尚未設定 ANTHROPIC_API_KEY 或 OPENAI_API_KEY。");
}

export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "請傳送有效的 JSON。" }, { status: 400 });
  }

  const leadId = body.leadId?.trim();
  const notes = body.notes?.trim();

  if (!leadId) {
    return NextResponse.json({ error: "缺少 leadId。" }, { status: 400 });
  }
  if (!notes) {
    return NextResponse.json({ error: "客戶筆記不可為空，請先補上再進行 AI 分析。" }, { status: 400 });
  }

  try {
    const analysis = await runAnalysis(notes);
    const supabase = getServerSupabase();
    const actionPlan = JSON.stringify(analysis.actionPlan);

    const { data, error } = await supabase
      .from("leads")
      .update({
        summary: analysis.summary,
        action_plan: actionPlan,
      })
      .eq("id", leadId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `更新 leads 失敗：${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ lead: data as Lead });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失敗，請稍後再試。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
