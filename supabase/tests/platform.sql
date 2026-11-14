-- Asserts the platform schema contract (SPEC-platform success criterion 4).
-- Runs in a transaction that is rolled back, so it leaves no data behind. Returns 'platform ok' or raises.
begin;

do $$
declare
  t text;
  doc_id uuid;
  blocked boolean;
begin
  -- 1. Every platform table exists with RLS enabled and no policies (deny by default).
  foreach t in array array['documents', 'pipeline_runs', 'audit_events', 'usage_ledger'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t and rowsecurity) then
      raise exception 'table %: missing or RLS disabled', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'table %: has policies, expected none', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'table %: anon/authenticated still hold SELECT', t;
    end if;
  end loop;

  -- 2. audit_events is append-only: inserts work, update/delete raise.
  insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
  values (repeat('a', 64), 't.pdf', 'application/pdf', 1, 'test/t.pdf', 'upload') returning id into doc_id;
  insert into public.audit_events (document_id, step, actor, event) values (doc_id, 1, 'system', 'received');

  blocked := false;
  begin update public.audit_events set event = 'tampered'; exception when others then blocked := true; end;
  if not blocked then raise exception 'audit_events: UPDATE was allowed'; end if;

  blocked := false;
  begin delete from public.audit_events; exception when others then blocked := true; end;
  if not blocked then raise exception 'audit_events: DELETE was allowed'; end if;

  -- 3. Constraints reject malformed rows.
  blocked := false;
  begin insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
        values ('not-a-hash', 'x', 'application/pdf', 1, 'x', 'upload');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'documents: bad sha256 accepted'; end if;

  blocked := false;
  begin insert into public.audit_events (document_id, step, actor, event) values (doc_id, 10, 'system', 'x');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'audit_events: step 10 accepted'; end if;

  blocked := false;
  begin insert into public.documents (sha256, filename, mime, size_bytes, storage_path, source)
        values (repeat('b', 64), 'c.pdf', 'application/pdf', 1, 'c', 'corpus');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'documents: corpus row without corpus_meta accepted'; end if;

  -- 4. Raw-reports bucket is private with upload limits.
  if not exists (select 1 from storage.buckets where id = 'raw-reports' and not public and file_size_limit = 10485760) then
    raise exception 'storage: raw-reports bucket missing, public, or wrong size limit';
  end if;
end $$;

select 'platform ok' as result;
rollback;
