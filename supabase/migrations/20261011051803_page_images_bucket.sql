-- Rendered page images for the vision fallback (step 4) and the vision read B (step 7). Private like raw-reports;
-- only Netlify Functions (service role) read or write them. Path: <document sha256>/p<page>@<dpi>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-images', 'page-images', false, 10485760, array['image/png']);
