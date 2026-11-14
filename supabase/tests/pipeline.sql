-- Asserts the pipeline schema contract (SPEC-pipeline "Data"). Rolled back; returns 'pipeline ok' or raises.
begin;

do $$
declare
  t text;
  doc_id uuid;
  run_id uuid;
  stale_doc uuid;
  stale_run uuid;
  blocked boolean;
begin
  foreach t in array array['extractions', 'known_funds', 'llm_cache'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t and rowsecurity) then
      raise exception 'table %: missing or RLS disabled', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then raise exception 'table %: anon holds SELECT', t; end if;
  end loop;

  if (select count(*) from public.known_funds) <> 4 then raise exception 'known_funds: expected the 4 known GPs'; end if;
  if exists (select 1 from public.known_funds where fund_name ilike '%tessera%') then
    raise exception 'known_funds: the unknown GP must not be registered';
  end if;

  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('c', 64), 'p.pdf', 'application/pdf', 1, 'upload/p.pdf', 'upload') returning id into doc_id;
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into run_id;

  -- 'extracted' is a valid status, reached through running (review.sql: the transition table)
  update public.pipeline_runs set status = 'running' where id = run_id;
  update public.pipeline_runs set status = 'extracted' where id = run_id;
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into run_id;

  -- one active run per document
  blocked := false;
  begin insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test');
  exception when unique_violation then blocked := true; end;
  if not blocked then raise exception 'pipeline_runs: a second active run for one document was accepted'; end if;

  -- extractions are append-only, one row per round
  insert into public.extractions (run_id, round, raw, checks) values (run_id, 0, '{}', '[]');
  blocked := false;
  begin update public.extractions set round = 1; exception when others then blocked := true; end;
  if not blocked then raise exception 'extractions: UPDATE was allowed'; end if;
  blocked := false;
  begin insert into public.extractions (run_id, round, raw, checks) values (run_id, 0, '{}', '[]');
  exception when unique_violation then blocked := true; end;
  if not blocked then raise exception 'extractions: duplicate round accepted'; end if;
  blocked := false;
  begin insert into public.extractions (run_id, round, raw, checks) values (run_id, 3, '{}', '[]');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'extractions: round 3 accepted (critic is capped at 2)'; end if;

  -- an abandoned run can be expired (security audit finding 2): queued -> failed and running -> failed are allowed, and a
  -- failed run frees its document for a new run
  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('d', 64), 's.pdf', 'application/pdf', 1, 'upload/s.pdf', 'upload') returning id into stale_doc;
  insert into public.pipeline_runs (document_id, pipeline_version) values (stale_doc, 'test') returning id into stale_run;
  update public.pipeline_runs set status = 'failed', error = 'abandoned: still queued' where id = stale_run;
  insert into public.pipeline_runs (document_id, pipeline_version) values (stale_doc, 'test') returning id into stale_run;
  update public.pipeline_runs set status = 'running', started_at = now() where id = stale_run;
  update public.pipeline_runs set status = 'failed', error = 'abandoned: still running' where id = stale_run;
  insert into public.pipeline_runs (document_id, pipeline_version) values (stale_doc, 'test');
  -- and a failed run stays failed: a late finish from a function that was only slow is refused
  blocked := false;
  begin update public.pipeline_runs set status = 'needs_review' where id = stale_run;
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'pipeline_runs: an expired run was moved on to needs_review'; end if;
end $$;

select 'pipeline ok' as result;
rollback;
