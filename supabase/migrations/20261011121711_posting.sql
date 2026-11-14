-- Sketch step 8 (SPEC-posting): the mock internal portfolio system and our posting log.

-- The mock system's store: one row per version of a fund's record for a period; the current version is the highest.
-- Append-only, so a superseded version is simply one with a higher version above it.
create table public.portfolio_records (
  id           bigint generated always as identity primary key,
  fund_id      uuid not null references public.known_funds (id) on delete restrict,
  period_end   date not null,
  version      integer not null check (version >= 1),
  source_run   uuid not null unique references public.pipeline_runs (id) on delete restrict, -- idempotency key
  figures_hash text not null,
  payload      jsonb not null,
  posted_at    timestamptz not null default now(),
  unique (fund_id, period_end, version)
);

-- Our side: every posting attempt, whatever its outcome.
create table public.postings (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references public.pipeline_runs (id) on delete restrict,
  attempt      integer not null check (attempt >= 1),
  outcome      text not null check (outcome in ('posted', 'unchanged', 'failed', 'rejected')),
  record_id    text,
  version      integer,
  error        text,
  figures_hash text,
  created_at   timestamptz not null default now(),
  unique (run_id, attempt)
);
create index postings_run_id_idx on public.postings (run_id);

create trigger portfolio_records_no_update_delete before update or delete on public.portfolio_records
  for each row execute function public.forbid_mutation();
create trigger portfolio_records_no_truncate before truncate on public.portfolio_records
  for each statement execute function public.forbid_mutation();
create trigger postings_no_update_delete before update or delete on public.postings
  for each row execute function public.forbid_mutation();
create trigger postings_no_truncate before truncate on public.postings
  for each statement execute function public.forbid_mutation();
alter table public.portfolio_records enable row level security;
alter table public.postings enable row level security;
revoke all on public.portfolio_records, public.postings from anon, authenticated;

-- The mock system's API: idempotent by run, "unchanged" for identical figures, otherwise a new version. One lock per
-- fund and period, so two concurrent posts cannot both become the current version. Unknown fund -> check_violation (422).
create function public.portfolio_post(p_run uuid, p_record jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_fund uuid;
  v_period date;
  existing public.portfolio_records;
  current_row public.portfolio_records;
  next_version integer;
begin
  begin
    v_fund := (p_record->>'fund_id')::uuid;
    v_period := (p_record->>'period_end')::date;
  exception when others then
    raise exception 'record needs a fund id and a period end' using errcode = 'check_violation';
  end;
  if v_fund is null or v_period is null or coalesce(p_record->>'figures_hash', '') = '' then
    raise exception 'record needs a fund id, a period end and a figures hash' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.known_funds where id = v_fund) then
    raise exception 'unknown fund %', v_fund using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_fund::text || ':' || v_period::text));

  select * into existing from public.portfolio_records where source_run = p_run;
  if found then
    return jsonb_build_object('kind', 'duplicate', 'record_id', v_fund::text || ':' || v_period::text, 'version', existing.version, 'supersedes', null);
  end if;
  select * into current_row from public.portfolio_records where fund_id = v_fund and period_end = v_period order by version desc limit 1;
  if found and current_row.figures_hash = p_record->>'figures_hash' then
    return jsonb_build_object('kind', 'unchanged', 'record_id', v_fund::text || ':' || v_period::text, 'version', current_row.version, 'supersedes', null);
  end if;
  next_version := coalesce(current_row.version, 0) + 1;
  insert into public.portfolio_records (fund_id, period_end, version, source_run, figures_hash, payload)
  values (v_fund, v_period, next_version, p_run, p_record->>'figures_hash', p_record);
  return jsonb_build_object('kind', 'posted', 'record_id', v_fund::text || ':' || v_period::text, 'version', next_version,
    'supersedes', case when next_version > 1 then next_version - 1 end);
end $$;

-- Our side, atomically: the attempt (numbered per run), the step-8 audit event, and the run's status change to posted.
create function public.complete_posting(p_run uuid, p_attempt jsonb, p_set_posted boolean) returns void
language plpgsql set search_path = '' as $$
declare
  next_attempt integer;
begin
  perform 1 from public.pipeline_runs where id = p_run for update;
  if not found then raise exception 'run % not found', p_run using errcode = 'no_data_found'; end if;
  select coalesce(max(attempt), 0) + 1 into next_attempt from public.postings where run_id = p_run;
  insert into public.postings (run_id, attempt, outcome, record_id, version, error, figures_hash)
  values (p_run, next_attempt, p_attempt->>'outcome', p_attempt->>'record_id', (p_attempt->>'version')::integer,
          p_attempt->>'error', p_attempt->>'figures_hash');
  insert into public.audit_events (run_id, step, actor, event, payload)
  values (p_run, 8, 'system', 'posting.' || (p_attempt->>'outcome'), p_attempt || jsonb_build_object('attempt', next_attempt));
  if p_set_posted then
    -- The transition trigger allows only ready_to_post / approved -> posted; a retry of a posted run changes nothing.
    update public.pipeline_runs set status = 'posted' where id = p_run and status <> 'posted';
  end if;
end $$;

revoke all on function public.portfolio_post(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_posting(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.portfolio_post(uuid, jsonb) to service_role;
grant execute on function public.complete_posting(uuid, jsonb, boolean) to service_role;
