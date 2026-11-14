// Run step "load": fetches the stored file and proves it is byte-identical to what was received (step 1).
import { sha256Hex } from "../hash.ts";
import type { LoadedDocument, Step } from "./run.ts";

export interface DocumentLoader {
  load(documentId: string): Promise<LoadedDocument>;
}

export function loadStep(loader: DocumentLoader): Step {
  return {
    name: "load",
    async run(ctx) {
      const loaded = await loader.load(ctx.documentId);
      const actual = await sha256Hex(loaded.bytes);
      if (actual !== loaded.document.sha256) {
        throw new Error(`integrity check failed: stored file hash ${actual.slice(0, 12)} does not match ${loaded.document.sha256.slice(0, 12)} recorded at receipt`);
      }
      const { filename, mime, size_bytes } = loaded.document;
      return { ctx: { ...ctx, loaded }, summary: { filename, mime, size_bytes } };
    },
  };
}
