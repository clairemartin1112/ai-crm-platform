"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  isSupabaseConfigured,
  supabase,
  type Lead,
  type LeadStatus,
} from "@/lib/supabase";

const STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "新名單" },
  { value: "contacted", label: "已聯繫" },
  { value: "qualified", label: "已合格" },
  { value: "negotiation", label: "洽談中" },
  { value: "won", label: "成交" },
  { value: "lost", label: "流失" },
];

function statusLabel(status: string) {
  return STATUSES.find((item) => item.value === status)?.label ?? status;
}

function statusClass(status: string) {
  switch (status) {
    case "new":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    case "contacted":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "qualified":
      return "bg-violet-50 text-violet-800 ring-violet-200";
    case "negotiation":
      return "bg-teal-50 text-teal-800 ring-teal-200";
    case "won":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "lost":
      return "bg-rose-50 text-rose-800 ring-rose-200";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function parseActionPlan(value: string | null): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // stored as plain text
  }
  return value
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
    .filter(Boolean);
}

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    company: "",
    status: "new" as LeadStatus,
    notes: "",
  });

  const showBanner = useCallback((type: "ok" | "error", text: string) => {
    setBanner({ type, text });
  }, []);

  const loadLeads = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      showBanner("error", "尚未設定 Supabase 環境變數。請複製 .env.example 為 .env.local 後重啟。");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      showBanner("error", `無法載入客戶：${error.message}`);
      setLeads([]);
    } else {
      setLeads((data ?? []) as Lead[]);
    }
    setLoading(false);
  }, [showBanner]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const empty = useMemo(() => !loading && leads.length === 0, [loading, leads.length]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError("請填寫客戶姓名。");
      return;
    }
    setFormError(null);

    setSaving(true);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        name,
        company: form.company.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
      })
      .select()
      .single();

    setSaving(false);

    if (error) {
      showBanner("error", `新增失敗：${error.message}`);
      return;
    }

    setLeads((current) => [data as Lead, ...current]);
    setForm({ name: "", company: "", status: "new", notes: "" });
    setModalOpen(false);
    showBanner("ok", `已新增客戶「${name}」。`);
  }

  async function handleStatusChange(lead: Lead, status: string) {
    if (status === lead.status) return;
    setUpdatingStatusId(lead.id);
    const previous = leads;
    setLeads((current) =>
      current.map((item) => (item.id === lead.id ? { ...item, status } : item)),
    );

    const { error } = await supabase.from("leads").update({ status }).eq("id", lead.id);
    setUpdatingStatusId(null);

    if (error) {
      setLeads(previous);
      showBanner("error", `狀態更新失敗：${error.message}`);
      return;
    }

    showBanner("ok", `${lead.name} 狀態已更新為「${statusLabel(status)}」。`);
  }

  async function handleAnalyze(lead: Lead) {
    const notes = lead.notes?.trim();
    if (!notes) {
      showBanner("error", `「${lead.name}」沒有筆記，請先補上內容再分析。`);
      return;
    }

    setAnalyzingId(lead.id);
    try {
      const response = await fetch("/api/analyze-lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, notes }),
      });
      const payload = (await response.json()) as { lead?: Lead; error?: string };

      if (!response.ok || !payload.lead) {
        showBanner("error", payload.error || "AI 分析失敗。");
        return;
      }

      setLeads((current) =>
        current.map((item) => (item.id === lead.id ? payload.lead! : item)),
      );
      showBanner("ok", `已完成「${lead.name}」的 AI 分析。`);
    } catch {
      showBanner("error", "無法連線分析 API，請稍後再試。");
    } finally {
      setAnalyzingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f4f0] text-zinc-900">
      <header className="border-b border-zinc-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal-800">
              AI CRM
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">客戶工作台</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setModalOpen(true);
            }}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            新增客戶
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {banner ? (
          <div
            className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
              banner.type === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {banner.text}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-zinc-500">載入客戶名單中…</p>
        ) : empty ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium">還沒有客戶</p>
            <p className="mt-2 text-sm text-zinc-500">點右上角「新增客戶」開始建立第一筆名單。</p>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {leads.map((lead) => {
              const analyzing = analyzingId === lead.id;
              const actionPlan = parseActionPlan(lead.action_plan);

              return (
                <article
                  key={lead.id}
                  className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{lead.name}</h2>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        {lead.company || "未填公司"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusClass(lead.status)}`}
                    >
                      {statusLabel(lead.status)}
                    </span>
                  </div>

                  <label className="mt-4 text-xs font-medium text-zinc-500">
                    狀態
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900"
                      value={lead.status}
                      disabled={updatingStatusId === lead.id}
                      onChange={(event) => void handleStatusChange(lead, event.target.value)}
                    >
                      {STATUSES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      筆記
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                      {lead.notes?.trim() || "尚無筆記"}
                    </p>
                  </div>

                  {lead.summary ? (
                    <div className="mt-4 rounded-xl bg-[#f3f7f6] p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-teal-800">
                        核心痛點
                      </p>
                      <p className="mt-1 text-sm leading-6 text-zinc-800">{lead.summary}</p>
                    </div>
                  ) : null}

                  {actionPlan.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                        建議下一步
                      </p>
                      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-zinc-700">
                        {actionPlan.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void handleAnalyze(lead)}
                    disabled={analyzing}
                    className="mt-5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {analyzing ? "分析中…" : "AI 分析"}
                  </button>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {modalOpen ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-zinc-950/40 p-4 sm:items-center">
          <form
            onSubmit={(event) => void handleCreate(event)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold">新增客戶</h2>
            <p className="mt-1 text-sm text-zinc-500">姓名為必填，其餘可之後再補。</p>
            {formError ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {formError}
              </p>
            ) : null}

            <label className="mt-5 block text-sm font-medium">
              姓名
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：王小明"
              />
            </label>

            <label className="mt-3 block text-sm font-medium">
              公司
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={form.company}
                onChange={(event) =>
                  setForm((current) => ({ ...current, company: event.target.value }))
                }
                placeholder="例如：星河科技"
              />
            </label>

            <label className="mt-3 block text-sm font-medium">
              狀態
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as LeadStatus,
                  }))
                }
              >
                {STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium">
              筆記
              <textarea
                className="mt-1 min-h-28 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="會議紀錄、需求、預算、決策者…"
              />
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "儲存中…" : "建立"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
