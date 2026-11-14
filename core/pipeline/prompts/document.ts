// How page text is handed to every prompt: inside <document><page> blocks, as data. Text that contains page or document
// tags (a crafted sheet name or cell, OCR'd text) could close its own block and pose as instructions, so those tag
// openings are neutralised. Ordinary report text is left byte-for-byte unchanged: recorded responses stay valid.
import type { ParsedPage } from "../parse.ts";

const TAG = /<(\/?)(page|document)(?=[\s>/]|$)/gi;
const neutralise = (text: string) => text.replace(TAG, "‹$1$2");

export function documentBlock(pages: ParsedPage[]): string {
  return `<document>\n${pages.map((p) => `<page number="${p.page}">\n${neutralise(p.text)}\n</page>`).join("\n")}\n</document>`;
}
