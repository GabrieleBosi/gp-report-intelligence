-- Which pipeline step spent the money (cost by step across runs; feeds model-choice decisions per step).
alter table public.usage_ledger add column step text;
