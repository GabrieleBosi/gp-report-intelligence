// Simulates a scanned paper report: every page rasterized at 150 dpi in grey, rotated 2 degrees, with seeded noise and a
// slight blur, then reassembled as an image-only PDF (no text layer). Needs poppler (pdftoppm) and ImageMagick 7.
// Output depends on the ImageMagick build, so scans are made once, committed, and excluded from the byte check.
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const SCAN_DPI = 150;

export async function scanPdf(pdf: Buffer, seed: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-scan-"));
  try {
    await writeFile(path.join(dir, "in.pdf"), pdf);
    execFileSync("pdftoppm", ["-r", String(SCAN_DPI), "-gray", "-png", path.join(dir, "in.pdf"), path.join(dir, "page")]);
    const pages = (await readdir(dir)).filter((n) => n.startsWith("page") && n.endsWith(".png")).sort();
    const degraded = pages.map((page, i) => {
      const out = path.join(dir, `scan-${i}.png`);
      execFileSync("magick", [path.join(dir, page), "-seed", String(seed + i), "-background", "white", "-rotate", i % 2 ? "-1.5" : "2",
        "-attenuate", "0.15", "+noise", "Gaussian", "-blur", "0x0.3", "-colorspace", "Gray", "-strip", out]);
      return out;
    });
    const out = path.join(dir, "scan.pdf");
    execFileSync("magick", [...degraded, "-density", String(SCAN_DPI), "-compress", "jpeg", "-quality", "75", out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
