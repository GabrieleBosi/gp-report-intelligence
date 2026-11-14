-- Step 9 (SPEC-review): analyst decisions, the approved status, and run status transitions enforced in the database.

alter table public.pipeline_runs drop constraint pipeline_runs_status_check;
alter table public.pipeline_runs add constraint pipeline_runs_status_check
  check (status in ('queued', 'running', 'extracted', 'ready_to_post', 'needs_review', 'needs_triage', 'approved', 'posted', 'rejected', 'failed'));

-- The transition table (mirrors core/review/actions.ts for review; posting moves ready_to_post / approved to posted).
create function public.check_run_transition() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if (old.status, new.status) in (
    ('queued', 'running'), ('queued', 'failed'),
    ('running', 'extracted'), ('running', 'ready_to_post'), ('running', 'needs_review'), ('running', 'needs_triage'), ('running', 'failed'),
    ('needs_review', 'approved'), ('needs_review', 'rejected'),
    ('needs_triage', 'needs_review'), ('needs_triage', 'rejected'),
    ('ready_to_post', 'posted'), ('approved', 'posted')
  ) then return new; end if;
  raise exception 'run status cannot change from % to %', old.status, new.status using errcode = 'check_violation';
end $$;
create trigger pipeline_runs_transition before update of status on public.pipeline_runs
  for each row execute function public.check_run_transition();

-- Analyst correction rounds sit after the pipeline's rounds 0-2.
alter table public.extractions add column source text not null default 'pipeline' check (source in ('pipeline', 'analyst'));
alter table public.extractions drop constraint extractions_round_check;
alter table public.extractions add constraint extractions_round_check
  check ((source = 'pipeline' and round between 0 and 2) or (source = 'analyst' and round between 3 and 99));

alter table public.audit_events drop constraint audit_events_actor_check;
alter table public.audit_events add constraint audit_events_actor_check check (actor ~ '^(system|analyst|analyst:.+|llm:.+)$');

-- Every analyst decision, append-only: who decided what, before/after as printed, why, under which policy.
create table public.review_decisions (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.pipeline_runs (id) on delete restrict,
  kind       text not null check (kind in ('field_accepted', 'field_corrected', 'approved', 'rejected', 'fund_assigned')),
  field      text,
  before     jsonb,
  after      jsonb,
  reason     text,
  analyst    text not null check (length(btrim(analyst)) between 1 and 80),
  policy     text not null,
  created_at timestamptz not null default now(),
  check (kind <> 'rejected' or length(btrim(coalesce(reason, ''))) > 0)
);
create index review_decisions_run_id_idx on public.review_decisions (run_id);
create trigger review_decisions_no_update_delete before update or delete on public.review_decisions
  for each row execute function public.forbid_mutation();
create trigger review_decisions_no_truncate before truncate on public.review_decisions
  for each statement execute function public.forbid_mutation();
alter table public.review_decisions enable row level security;
revoke all on public.review_decisions from anon, authenticated;

-- Applies one decision atomically, only if the run is still in the status the analyst saw (two tabs cannot both act).
create function public.apply_review_decision(p_run uuid, p_expected text, p_next text, p_decision jsonb, p_extraction jsonb)
returns text language plpgsql set search_path = '' as $$
declare
  current_status text;
begin
  select status into current_status from public.pipeline_runs where id = p_run for update;
  if current_status is null then raise exception 'run % not found', p_run using errcode = 'no_data_found'; end if;
  if current_status <> p_expected then
    raise exception 'run is % now, not %', current_status, p_expected using errcode = 'serialization_failure';
  end if;

  insert into public.review_decisions (run_id, kind, field, before, after, reason, analyst, policy)
  values (p_run, p_decision->>'kind', p_decision->>'field', p_decision->'before', p_decision->'after',
          nullif(btrim(coalesce(p_decision->>'reason', '')), ''), p_decision->>'analyst', p_decision->>'policy');

  if p_next <> current_status then update public.pipeline_runs set status = p_next where id = p_run; end if;

  if p_extraction is not null then
    insert into public.extractions (run_id, round, raw, extraction, checks, source)
    select p_run, greatest(coalesce(max(round), 0) + 1, 3), p_extraction->'raw', p_extraction->'extraction', p_extraction->'checks', 'analyst'
    from public.extractions where run_id = p_run;
  end if;

  insert into public.audit_events (run_id, step, actor, event, payload)
  values (p_run, 9, 'analyst:' || btrim(p_decision->>'analyst'), 'review.' || (p_decision->>'kind'), p_decision);
  return p_next;
end $$;
revoke all on function public.apply_review_decision(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_review_decision(uuid, text, text, jsonb, jsonb) to service_role;
revoke all on function public.check_run_transition() from public, anon, authenticated;
