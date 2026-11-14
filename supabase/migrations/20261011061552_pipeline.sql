-- Pipeline tables (SPEC-pipeline "Data"). Same access model as the platform tables (ADR-0003).

-- 'extracted': the pipeline finished; step 7 (confidence) takes over from here.
alter table public.pipeline_runs drop constraint pipeline_runs_status_check;
alter table public.pipeline_runs add constraint pipeline_runs_status_check
  check (status in ('queued', 'running', 'extracted', 'needs_review', 'posted', 'rejected', 'failed'));

-- One active run per document: a second "Run" click must not start a parallel, double-billed run.
create unique index pipeline_runs_one_active_per_document
  on public.pipeline_runs (document_id) where status in ('queued', 'running');

-- One row per round (0 = first pass, 1-2 = critic rounds), append-only, so every value change stays auditable.
create table public.extractions (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.pipeline_runs (id) on delete restrict,
  round      smallint not null check (round between 0 and 2),
  raw        jsonb not null,  -- raw printed strings + page + read mode, as returned by the LLM
  extraction jsonb,           -- schema v1 after normalization (null if normalization failed)
  checks     jsonb not null,  -- identity check results
  created_at timestamptz not null default now(),
  unique (run_id, round)
);

create function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only (% blocked)', tg_table_name, tg_op;
end $$;

create trigger extractions_no_update_delete before update or delete on public.extractions
  for each row execute function public.forbid_mutation();
create trigger extractions_no_truncate before truncate on public.extractions
  for each statement execute function public.forbid_mutation();

-- Reference data: the GPs the investor works with. Step 2 matches the classified fund against it; no match = triage.
create table public.known_funds (
  id         uuid primary key default gen_random_uuid(),
  gp_name    text not null,
  fund_name  text not null unique,
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);
insert into public.known_funds (gp_name, fund_name, aliases) values
  ('Alpenrose Capital', 'Alpenrose Buyout IV', '{"Alpenrose IV"}'),
  ('Harbourline Partners', 'Harbourline Growth II', '{"Harbourline II"}'),
  ('Nordkap Equity', 'Nordkap Mid-Market III', '{"Nordkap MM III", "Nordkap III"}'),
  ('Meridian Growth', 'Meridian Tech Opportunities I', '{"Meridian TO I"}');

-- Recorded LLM responses keyed by cacheKey (model, prompt id@version, effort, input): repeat runs cost nothing.
create table public.llm_cache (
  key        text primary key check (key ~ '^[0-9a-f]{64}$'),
  prompt     text not null,
  model      text not null,
  output     jsonb not null,
  usage      jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.extractions enable row level security;
alter table public.known_funds enable row level security;
alter table public.llm_cache   enable row level security;
revoke all on public.extractions, public.known_funds, public.llm_cache from anon, authenticated;
revoke execute on function public.forbid_mutation() from public, anon, authenticated;
