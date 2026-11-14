-- Descriptive metadata for corpus documents (doc_id, GP, fund, period, format, split), shown in the UI.
-- Never holds expected values, and the pipeline must never read it (label leakage would invalidate evals).
alter table public.documents add column corpus_meta jsonb;
alter table public.documents add constraint documents_corpus_meta_matches_source
  check ((source = 'corpus') = (corpus_meta is not null));
