// npm run corpus:seed - uploads the corpus to Supabase (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env).
import path from "node:path";
import { createSupabaseDocumentStore } from "../netlify/lib/document-store.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { seedCorpus } from "./seed-corpus.ts";

const root = path.resolve(import.meta.dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const client = createAdminClient(process.env);
if (!client) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");

for (const { document, created } of await seedCorpus(root, createSupabaseDocumentStore(client))) {
  console.log(`${created ? "added  " : "exists "} ${document.filename}`);
}
