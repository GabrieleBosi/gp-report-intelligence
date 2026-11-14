import type { MouseEvent } from "react";
import { useNavigate } from "react-router";

// Rendered Markdown (src/showcase/markdown.ts: the repository's own content). In-app links navigate without a reload.
export function Markdown({ html, className }: { html: string; className?: string }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = e.target instanceof Element ? e.target.closest("a") : null;
    const href = a?.getAttribute("href");
    if (!a || !href?.startsWith("/") || a.target === "_blank" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate(href);
  };
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
