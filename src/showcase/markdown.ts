// The repository's own Markdown, rendered in the app (SPEC-showcase decision 1: marked, our content only). Raw HTML is
// escaped rather than sanitized, so nothing in a document is ever interpreted as markup.
// Links resolve relative to the file they appear in: a link to a renderable document becomes an in-app link, a web link
// opens in a new tab, anything else (source files, JSON, paths outside the repository) is left as text.
import { Marked, type Tokens } from "marked";
import { isArtifact, slug } from "./content.ts";

export type ResolvedLink = { kind: "internal"; to: string } | { kind: "external"; href: string } | { kind: "none" };

export function resolveLink(href: string, fromFile: string): ResolvedLink {
  if (/^https?:\/\//.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "none" }; // mailto:, javascript:, …
  const [target = "", hash] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  if (target === "") return { kind: "internal", to: `/docs/${fromFile}${anchor}` };

  const parts = fromFile.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") { if (parts.pop() === undefined) return { kind: "none" }; }
    else if (part !== "." && part !== "") parts.push(part);
  }
  const file = parts.join("/");
  return isArtifact(file) ? { kind: "internal", to: `/docs/${file}${anchor}` } : { kind: "none" };
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function markedFor(fromFile: string): Marked {
  return new Marked({
    gfm: true,
    renderer: {
      link(this: { parser: { parseInline: (t: Tokens.Link["tokens"]) => string } }, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const link = resolveLink(token.href, fromFile);
        if (link.kind === "internal") return `<a href="${attr(link.to)}">${text}</a>`;
        if (link.kind === "external") return `<a href="${attr(link.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        return text;
      },
      // Raw HTML is shown as text: a "<placeholder>" in prose stays visible, and no markup passes through.
      html(token: Tokens.HTML | Tokens.Tag) {
        return token.raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      },
      heading(this: { parser: { parseInline: (t: Tokens.Heading["tokens"]) => string } }, token: Tokens.Heading) {
        return `<h${token.depth} id="${slug(token.text)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
    },
  });
}

export function renderMarkdown(markdown: string, fromFile: string, options: { inline?: boolean } = {}): string {
  const marked = markedFor(fromFile);
  return options.inline ? marked.parseInline(markdown, { async: false }) : marked.parse(markdown, { async: false });
}
