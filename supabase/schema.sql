create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  status text not null default 'new',
  notes text,
  summary text,
  action_plan text,
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

drop policy if exists "leads_anon_all" on public.leads;
create policy "leads_anon_all"
  on public.leads
  for all
  using (true)
  with check (true);
