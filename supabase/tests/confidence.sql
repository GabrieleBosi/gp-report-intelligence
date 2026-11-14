-- Asserts the confidence schema contract (SPEC-confidence "Data and status"). Rolled back; returns 'confidence ok' or raises.
begin;

do $$
declare
  doc_id uuid;
  run_id uuid;
  blocked boolean;
  s text;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'assessments' and rowsecurity) then
    raise exception 'assessments: missing or RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.assessments', 'select') then raise exception 'assessments: anon holds SELECT'; end if;

  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('d', 64), 'k.pdf', 'application/pdf', 1, 'upload/k.pdf', 'upload') returning id into doc_id;
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into run_id;

  -- Each final status of step 7 is reachable from running (runs move through the transition table, review.sql).
  foreach s in array array['ready_to_post', 'needs_review', 'needs_triage'] loop
    update public.pipeline_runs set status = 'running' where id = run_id;
    update public.pipeline_runs set status = s where id = run_id;
    insert into public.pipeline_runs (document_id, pipeline_version, status) values (doc_id, 'test', 'queued') returning id into run_id;
  end loop;

  insert into public.assessments (run_id, round, route, level, fields, reasons, policy)
  values (run_id, 0, 'review', 'low', '[]', '{"TVPI: the report itself may be inconsistent."}', 'policy@1');

  blocked := false;
  begin update public.assessments set route = 'auto_post'; exception when others then blocked := true; end;
  if not blocked then raise exception 'assessments: UPDATE was allowed (a routing decision must never be rewritten)'; end if;

  blocked := false;
  begin insert into public.assessments (run_id, round, route, level, fields, reasons, policy)
        values (run_id, 0, 'maybe', 'low', '[]', '{}', 'policy@1');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'assessments: unknown route accepted'; end if;
end $$;

select 'confidence ok' as result;
rollback;
