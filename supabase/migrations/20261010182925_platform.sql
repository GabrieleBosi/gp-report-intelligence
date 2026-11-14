-- Platform tables (SPEC-platform "Data model"). Later modules add their own migrations.
-- Access model: only Netlify Functions touch the DB, with the service-role key. RLS is on with no
-- policies and anon/authenticated grants are revoked, so the browser can read or write nothing (ADR-0003).

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  sha256       text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  filename     text not null check (length(filename) between 1 and 255),
  mime         text not null,
  size_bytes   integer not null check (size_bytes > 0),
  storage_path text not null,
  source       text not null check (source in ('corpus', 'upload')),
  created_at   timestamptz not null default now()
);

create table public.pipeline_runs (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents (id) on delete restrict,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'needs_review', 'posted', 'rejected', 'failed')),
  pipeline_version text not null,
  started_at       timestamptz,
  finished_at      timestamptz,
  error            text,
  created_at       timestamptz not null default now()
);
create index pipeline_runs_document_id_idx on public.pipeline_runs (document_id);

-- One row per pipeline step. Step 1 (receive) happens before a run exists, so a row needs a run or a document.
create table public.audit_events (
  id          bigint generated always as identity primary key,
  run_id      uuid references public.pipeline_runs (id) on delete restrict,
  document_id uuid references public.documents (id) on delete restrict,
  step        smallint not null check (step between 1 and 9),
  actor       text not null check (actor ~ '^(system|analyst|llm:.+)$'),
  event       text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  check (run_id is not null or document_id is not null)
);
create index audit_events_run_id_idx on public.audit_events (run_id);
create index audit_events_document_id_idx on public.audit_events (document_id);

-- Append-only: blocks UPDATE, DELETE and TRUNCATE for every role, including service_role.
create function public.forbid_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events is append-only (% blocked)', tg_op;
end $$;

create trigger audit_events_no_update_delete before update or delete on public.audit_events
  for each row execute function public.forbid_audit_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.forbid_audit_mutation();

-- Feeds the daily LLM spend cap (DAILY_LLM_BUDGET_USD).
create table public.usage_ledger (
  id            bigint generated always as identity primary key,
  run_id        uuid references public.pipeline_runs (id) on delete restrict,
  model         text not null,
  input_tokens  integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd      numeric(10, 6) not null check (cost_usd >= 0),
  created_at    timestamptz not null default now()
);
create index usage_ledger_created_at_idx on public.usage_ledger (created_at);
create index usage_ledger_run_id_idx on public.usage_ledger (run_id);

alter table public.documents     enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.audit_events  enable row level security;
alter table public.usage_ledger  enable row level security;

revoke all on public.documents, public.pipeline_runs, public.audit_events, public.usage_ledger
  from anon, authenticated;
revoke execute on function public.forbid_audit_mutation() from public, anon, authenticated;

-- Private bucket for raw uploads and corpus files. Limits mirror the upload guardrails.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'raw-reports', 'raw-reports', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
);
