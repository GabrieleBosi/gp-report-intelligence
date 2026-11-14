-- Step 7 (SPEC-confidence): the run's final status comes from the confidence step.
alter table public.pipeline_runs drop constraint pipeline_runs_status_check;
alter table public.pipeline_runs add constraint pipeline_runs_status_check
  check (status in ('queued', 'running', 'extracted', 'ready_to_post', 'needs_review', 'needs_triage', 'posted', 'rejected', 'failed'));

-- One assessment per run (and per re-assessment): the per-figure evidence, the route and the policy version that
-- produced it. Append-only: a routing decision is never rewritten, so "why was this posted?" always has an answer.
create table public.assessments (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.pipeline_runs (id) on delete restrict,
  round      smallint not null check (round between 0 and 2),
  route      text not null check (route in ('auto_post', 'review', 'triage')),
  level      text not null check (level in ('high', 'medium', 'low')),
  fields     jsonb not null,
  reasons    text[] not null,
  policy     text not null,
  created_at timestamptz not null default now()
);
create index assessments_run_id_idx on public.assessments (run_id);

create trigger assessments_no_update_delete before update or delete on public.assessments
  for each row execute function public.forbid_mutation();
create trigger assessments_no_truncate before truncate on public.assessments
  for each statement execute function public.forbid_mutation();

alter table public.assessments enable row level security;
revoke all on public.assessments from anon, authenticated;
