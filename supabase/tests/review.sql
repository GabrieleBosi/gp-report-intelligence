-- Asserts the review schema contract (SPEC-review "Data and status"). Rolled back; returns 'review ok' or raises.
begin;

do $$
declare
  doc_id uuid;
  v_run uuid;
  blocked boolean;
  next_status text;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'review_decisions' and rowsecurity) then
    raise exception 'review_decisions: missing or RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.review_decisions', 'select') then raise exception 'review_decisions: anon holds SELECT'; end if;
  if has_function_privilege('anon', 'public.apply_review_decision(uuid, text, text, jsonb, jsonb)', 'execute') then
    raise exception 'apply_review_decision: anon may execute';
  end if;

  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('e', 64), 'r.pdf', 'application/pdf', 1, 'upload/r.pdf', 'upload') returning id into doc_id;
  insert into public.pipeline_runs (document_id, pipeline_version) values (doc_id, 'test') returning id into v_run;

  -- Pipeline transitions are allowed; a jump past review is not.
  update public.pipeline_runs set status = 'running' where id = v_run;
  update public.pipeline_runs set status = 'needs_review' where id = v_run;
  blocked := false;
  begin update public.pipeline_runs set status = 'posted' where id = v_run; exception when others then blocked := true; end;
  if not blocked then raise exception 'transition needs_review -> posted was allowed'; end if;

  -- A decision applies atomically: decision row, status, analyst extraction round, audit event.
  next_status := public.apply_review_decision(v_run, 'needs_review', 'needs_review',
    '{"kind":"field_corrected","field":"fund.nav","before":{"raw":"724","page":3},"after":{"raw":"72.4","page":3},"reason":null,"analyst":"Gabriele","policy":"policy@2"}',
    '{"raw":{},"extraction":null,"checks":[]}');
  if next_status <> 'needs_review' then raise exception 'correction changed the status'; end if;
  if (select count(*) from public.extractions e where e.run_id = v_run and e.source = 'analyst' and e.round >= 3) <> 1 then
    raise exception 'analyst round not stored';
  end if;
  if not exists (select 1 from public.audit_events a where a.run_id = v_run and a.step = 9 and a.actor = 'analyst:Gabriele') then
    raise exception 'audit event for the decision missing';
  end if;

  -- A stale view (expected status no longer current) is refused, and nothing is written.
  blocked := false;
  begin
    perform public.apply_review_decision(v_run, 'needs_triage', 'needs_review',
      '{"kind":"fund_assigned","field":null,"before":null,"after":null,"reason":null,"analyst":"G","policy":"policy@2"}', null);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'decision on a stale status was accepted'; end if;

  -- A rejection without a reason is refused by the table itself.
  blocked := false;
  begin
    perform public.apply_review_decision(v_run, 'needs_review', 'rejected',
      '{"kind":"rejected","field":null,"before":null,"after":null,"reason":"  ","analyst":"G","policy":"policy@2"}', null);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'rejection without a reason was stored'; end if;

  perform public.apply_review_decision(v_run, 'needs_review', 'approved',
    '{"kind":"approved","field":null,"before":null,"after":null,"reason":"posted as printed","analyst":"G","policy":"policy@2"}', null);
  if (select status from public.pipeline_runs where id = v_run) <> 'approved' then raise exception 'approval did not set the status'; end if;

  -- Decisions are never rewritten.
  blocked := false;
  begin update public.review_decisions set reason = 'changed'; exception when others then blocked := true; end;
  if not blocked then raise exception 'review_decisions: UPDATE was allowed'; end if;

  -- Approving twice is a forbidden transition.
  blocked := false;
  begin update public.pipeline_runs set status = 'approved' where id = v_run and status = 'approved';
        update public.pipeline_runs set status = 'needs_review' where id = v_run;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'transition approved -> needs_review was allowed'; end if;
end $$;

select 'review ok' as result;
rollback;
