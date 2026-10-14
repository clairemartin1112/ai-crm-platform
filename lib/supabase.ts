import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "negotiation"
  | "won"
  | "lost";

export type Lead = {
  id: string;
  name: string;
  company: string | null;
  status: LeadStatus | string;
  notes: string | null;
  summary: string | null;
  action_plan: string | null;
  created_at: string;
};

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

export const isSupabaseConfigured = Boolean(
  getSupabaseUrl() && getAnonKey(),
);

export const supabase: SupabaseClient = createClient(
  getSupabaseUrl() || "https://placeholder.supabase.co",
  getAnonKey() || "public-anon-key",
);

export function getServerSupabase(): SupabaseClient {
  const url = getSupabaseUrl();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || getAnonKey();

  if (!url || !key) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 API key，請檢查環境變數。");
  }

  return createClient(url, key);
}
