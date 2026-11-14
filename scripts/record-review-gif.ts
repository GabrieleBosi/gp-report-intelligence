// npm run media:review-gif: records the README's GIF (SPEC-public-release W3) on the public site as visitors get it:
// the static build with no functions, a flagged figure corrected on the review screen, approved, and posted. Needs the
// system Chromium (CHROMIUM_PATH to override) and the system ffmpeg: frames come from Chromium's screencast with their
// times (Playwright's own video recorder would download its ffmpeg build). Writes docs/media/review-fix.gif.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ROOT } from "../tests/support/dev-corpus.ts";

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, "docs/media/review-fix.gif");
const FILE = "alpenrose-iv-2025q3-chart-nav.pdf";

execFileSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const frameDir = await mkdtemp(path.join(tmpdir(), "review-gif-"));
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pause = (ms = 900) => page.waitForTimeout(ms);
  const frames: { file: string; at: number }[] = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    const file = path.join(frameDir, `${String(frames.length).padStart(4, "0")}.png`);
    frames.push({ file, at: (metadata.timestamp ?? 0) * 1000 });
    void writeFile(file, Buffer.from(data, "base64")).then(() => cdp.send("Page.screencastFrameAck", { sessionId }));
  });
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1280, maxHeight: 800 });

  await page.goto(`${BASE}/review`);
  await page.getByRole("link", { name: new RegExp(FILE.replaceAll(".", "\\.")) }).waitFor();
  await pause(1500);
  await page.getByRole("link", { name: new RegExp(FILE.replaceAll(".", "\\.")) }).click();
  await page.getByRole("img", { name: `Page 1 of ${FILE}` }).waitFor();
  await pause(1500);
  await page.getByLabel("Your name").pressSequentially("A visitor", { delay: 60 });
  const correct = page.getByRole("button", { name: "Correct Net asset value" });
  await correct.scrollIntoViewIfNeeded();
  await pause(1200);
  await correct.click();
  await pause();
  await page.getByLabel("Value as printed").fill("");
  await page.getByLabel("Value as printed").pressSequentially("431.1", { delay: 120 });
  await pause();
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByText(/corrected fund\.nav/).waitFor();
  await pause(1500);
  const approve = page.getByRole("button", { name: "Approve for posting" });
  await approve.scrollIntoViewIfNeeded();
  await pause();
  await approve.click();
  await page.getByText("posted", { exact: true }).first().waitFor();
  await pause(2000);
  await page.getByRole("link", { name: "Portfolio system", exact: true }).click();
  await page.getByRole("row", { name: /Alpenrose Buyout IV.*Q3 2025/ }).waitFor();
  await pause(2500);
  await cdp.send("Page.stopScreencast");
  await pause(300); // the last frames' files
  await context.close();
  await browser.close();

  console.log(`${frames.length} frames`);
  // Each frame is shown until the next one was taken (the concat demuxer's durations), the last one for 2 s.
  const list = frames.flatMap((f, i) => [`file '${f.file}'`, `duration ${(((frames[i + 1]?.at ?? f.at + 2000) - f.at) / 1000).toFixed(3)}`]);
  await writeFile(path.join(frameDir, "frames.txt"), `${[...list, `file '${frames.at(-1)?.file ?? ""}'`].join("\n")}\n`);
  const filters = "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(frameDir, "frames.txt"),
    "-vf", filters, "-loop", "0", OUT], { stdio: "inherit" });
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
} finally {
  server.kill();
  await rm(frameDir, { recursive: true, force: true });
}
