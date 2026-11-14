import type { AuditEventInput, DocumentRecord, DocumentStore, NewDocument } from "../../core/documents.ts";

// In-memory DocumentStore fake shared by tests (ADR-0001: core logic is tested against fakes, not Supabase).
export class InMemoryStore implements DocumentStore {
  documents: DocumentRecord[] = [];
  files = new Map<string, { bytes: Uint8Array; mime: string }>();
  audit: AuditEventInput[] = [];
  private nextId = 1;

  async findBySha256(sha256: string) { return this.documents.find((d) => d.sha256 === sha256) ?? null; }
  async putFile(path: string, bytes: Uint8Array, mime: string) { this.files.set(path, { bytes, mime }); }
  async insert(doc: NewDocument) {
    const record = { ...doc, id: `doc-${this.nextId++}`, created_at: `2026-10-10T12:00:0${this.nextId}Z` };
    this.documents.push(record);
    return record;
  }
  async appendAudit(event: AuditEventInput) { this.audit.push(event); }
  async list() { return [...this.documents]; }
}
