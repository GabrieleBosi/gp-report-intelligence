-- Asserts the posting schema contract (SPEC-posting "Data and status"). Rolled back; returns 'posting ok' or raises.
begin;

do $$
declare
  doc_id uuid; v_run uuid; v_run2 uuid; fund uuid; r jsonb; blocked boolean; rec jsonb; t text;
begin
  foreach t in array array['portfolio_records', 'postings'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t and rowsecurity) then
      raise exception '%: missing or RLS disabled', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then raise exception '%: anon holds SELECT', t; end if;
  end loop;

  select id into fund from public.known_funds limit 1;
  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('f', 64), 'p.pdf', 'application/pdf', 1, 'upload/p.pdf', 'upload') returning id into doc_id;
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into v_run;
  update public.pipeline_runs set status = 'running' where id = v_run;
  update public.pipeline_runs set status = 'ready_to_post' where id = v_run;
  rec := jsonb_build_object('fund_id', fund, 'period_end', '2099-12-31', 'figures_hash', repeat('a', 64), 'fund', '{}'::jsonb);

  -- First post: version 1. Retrying the same run: the same answer (duplicate), no second record.
  r := public.portfolio_post(v_run, rec);
  if r->>'kind' <> 'posted' or (r->>'version')::int <> 1 or r->>'supersedes' is not null then raise exception 'first post: %', r; end if;
  r := public.portfolio_post(v_run, rec);
  if r->>'kind' <> 'duplicate' or (r->>'version')::int <> 1 then raise exception 'retry: %', r; end if;

  -- Our side: attempt logged, audit event written, run posted.
  perform public.complete_posting(v_run, '{"outcome":"posted","record_id":"x","version":1,"error":null,"figures_hash":"a"}', true);
  if (select status from public.pipeline_runs where id = v_run) <> 'posted' then raise exception 'run not posted'; end if;
  if not exists (select 1 from public.audit_events a where a.run_id = v_run and a.step = 8 and a.event = 'posting.posted') then raise exception 'no audit event'; end if;

  -- Another run, same fund and period, same figures: unchanged. Different figures: version 2 supersedes 1.
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into v_run2;
  r := public.portfolio_post(v_run2, rec);
  if r->>'kind' <> 'unchanged' or (r->>'version')::int <> 1 then raise exception 'identical figures: %', r; end if;
  r := public.portfolio_post(v_run2, rec || jsonb_build_object('figures_hash', repeat('b', 64)));
  if r->>'kind' <> 'posted' or (r->>'version')::int <> 2 or (r->>'supersedes')::int <> 1 then raise exception 'restatement: %', r; end if;

  -- The system rejects an unknown fund (a 422 for the caller).
  blocked := false;
  begin perform public.portfolio_post(v_run2, rec || '{"fund_id":"00000000-0000-4000-8000-000000000000"}');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'unknown fund accepted'; end if;

  -- A failed attempt keeps the status; attempts are numbered; records and attempts are never rewritten.
  perform public.complete_posting(v_run2, '{"outcome":"failed","record_id":null,"version":null,"error":"timeout","figures_hash":"b"}', false);
  if (select status from public.pipeline_runs where id = v_run2) <> 'queued' then raise exception 'failed attempt changed the status'; end if;
  if (select max(attempt) from public.postings where run_id = v_run2) <> 1 then raise exception 'attempt numbering'; end if;
  blocked := false;
  begin update public.portfolio_records set version = 9; exception when others then blocked := true; end;
  if not blocked then raise exception 'portfolio_records: UPDATE was allowed'; end if;
  blocked := false;
  begin update public.postings set outcome = 'posted'; exception when others then blocked := true; end;
  if not blocked then raise exception 'postings: UPDATE was allowed'; end if;

  -- Posting a run that is not cleared is refused by the transition table.
  blocked := false;
  begin perform public.complete_posting(v_run2, '{"outcome":"posted","record_id":"x","version":2,"error":null,"figures_hash":"b"}', true);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'a queued run was set to posted'; end if;
end $$;

select 'posting ok' as result;
rollback;
