/**
 * `/dev/figure-print-size` 를 **인쇄 매체**로 헤드리스 갈무리한다.
 *
 *   node scripts/qa/shot-figure-print-size.mjs
 *   FIGURE_PRINT_SHOT_URL=http://127.0.0.1:3019 node scripts/qa/shot-figure-print-size.mjs
 *
 * 원장님 화면 포커스를 안 뺏는다(절대 규칙 9). Chromium 은 headless.
 *
 * `/figures/**` 는 미들웨어가 로그인 없이 307 로 막으므로, 갈무리할 때만
 * Playwright 가 `public/figures` 를 물려 준다. 제품은 안 건드린다.
 *
 * 산출물
 *   docs/design/mockups/figure-print-size-print.png     ← 지시서가 지정한 한 장
 *   docs/design/mockups/figure-print-size-shots/*.png   ← 갈래별 · 눈으로 보는 용
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs/design/mockups/figure-print-size-shots");
const PRINT_PNG = path.join(
  ROOT,
  "docs/design/mockups/figure-print-size-print.png",
);
const BASE =
  process.env.FIGURE_PRINT_SHOT_URL ?? "http://127.0.0.1:3019";
const FIGURE_ROOT = path.resolve(ROOT, "public", "figures");

const BUCKETS = [
  "배율 하위 5%",
  "배율 25%",
  "배율 중앙",
  "배율 75%",
  "배율 상위 5%",
  "15mm 미만",
  "커진다",
  "mm 모름 섞임",
  "mm 통째로 모름",
  "세로로 길다",
  "한 문항 여러 장",
];

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function safeFigurePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (!decoded.startsWith("/figures/")) return null;
  const parts = decoded.split("/").filter(Boolean); // figures, ...
  const file = path.resolve(ROOT, "public", ...parts);
  if (!file.startsWith(FIGURE_ROOT + path.sep) && file !== FIGURE_ROOT)
    return null;
  return file;
}

async function waitForImages(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => [...document.images].every((img) => img.complete),
    null,
    { timeout: 120_000 },
  );
}

async function openPrintPage(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith("/figures/")) {
      const file = safeFigurePath(u.pathname);
      if (!file) {
        await route.fulfill({ status: 400, body: "bad figure path" });
        return;
      }
      try {
        const body = readFileSync(file);
        await route.fulfill({
          status: 200,
          contentType: mimeFor(file),
          body,
        });
      } catch {
        await route.fulfill({ status: 404, body: "figure missing" });
      }
      return;
    }
    await route.continue();
  });
  await page.emulateMedia({ media: "print" });
  const res = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  if (!res || res.status() >= 400)
    throw new Error(`페이지를 못 연다 ${url} → ${res?.status()}`);
  await page.waitForSelector("[data-shot], .border-g-red-text", {
    timeout: 180_000,
  });
  await waitForImages(page);
  return page;
}

async function shotLocator(locator, dest) {
  const count = await locator.count();
  if (count === 0) return false;
  await locator.first().screenshot({ path: dest, animations: "disabled" });
  return true;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const ping = await fetch(`${BASE}/dev/figure-print-size`).catch((err) => {
    throw new Error(
      `개발 서버가 없다 (${BASE}). 먼저 npx next dev -p 3019 를 띄워라. ${err}`,
    );
  });
  if (!ping.ok && ping.status !== 404)
    console.warn(`경고: GET /dev/figure-print-size → ${ping.status}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--hide-scrollbars"],
  });
  const notes = [];
  const manifest = { summary: null, buckets: [] };

  try {
    const summaryPage = await openPrintPage(
      browser,
      `${BASE}/dev/figure-print-size?bucket=__none__`,
    );
    const stopped = await summaryPage.locator("text=비교를 그리지 않았다").count();
    if (stopped > 0) {
      await summaryPage.screenshot({
        path: path.join(OUT_DIR, "00-stopped.png"),
        fullPage: true,
        animations: "disabled",
      });
      throw new Error(
        "원장 또는 표본을 못 읽어 비교를 그리지 않았다. 00-stopped.png 를 보라.",
      );
    }
    const summaryPath = path.join(OUT_DIR, "00-summary.png");
    const summaryOk = await shotLocator(
      summaryPage.locator('[data-shot="요약"]'),
      summaryPath,
    );
    if (!summaryOk) throw new Error("요약 절을 못 찾았다");
    manifest.summary = "00-summary.png";
    notes.push("summary ok");
    await summaryPage.close();

    for (const [index, bucket] of BUCKETS.entries()) {
      const url = `${BASE}/dev/figure-print-size?bucket=${encodeURIComponent(bucket)}`;
      const page = await openPrintPage(browser, url);
      const prefix = String(index + 1).padStart(2, "0");
      const slug = bucket.replace(/[^\w가-힣]+/g, "-");
      const section = page.locator(`[data-shot="갈래:${bucket}"]`);
      if ((await section.count()) === 0) {
        notes.push(`MISSING ${bucket}`);
        await page.screenshot({
          path: path.join(OUT_DIR, `${prefix}-${slug}-MISSING.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.close();
        continue;
      }

      const tableName = `${prefix}-${slug}-table.png`;
      const table = section.locator("table").first();
      const hasTable = await shotLocator(table, path.join(OUT_DIR, tableName));

      // 🔴 문서 순서는 「지금」 전량 다음에 「새」 전량이다. 앞에서 4장만
      //    찍으면 15mm 미만(지금 13장)은 새 규칙이 한 장도 안 담긴다.
      const byRule = { 지금: [], 새: [] };
      for (const rule of ["지금", "새"]) {
        const papers = section.locator(
          `[data-rule="${rule}"] [data-print-page='true']`,
        );
        const n = await papers.count();
        notes.push(`${bucket}/${rule}: a4=${n}`);
        const take = Math.min(n, 2);
        for (let i = 0; i < take; i += 1) {
          const name = `${prefix}-${slug}-${rule}-p${i + 1}.png`;
          await papers.nth(i).screenshot({
            path: path.join(OUT_DIR, name),
            animations: "disabled",
          });
          byRule[rule].push(name);
        }
      }
      manifest.buckets.push({
        bucket,
        table: hasTable ? tableName : null,
        now: byRule["지금"],
        next: byRule["새"],
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    path.join(OUT_DIR, "notes.txt"),
    notes.join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  const stitch = spawnSync(
    "python",
    [path.join(ROOT, "scripts/qa/stitch-figure-print-size.py")],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (stitch.status !== 0) {
    console.error(stitch.stdout);
    console.error(stitch.stderr);
    throw new Error("stitch 실패");
  }
  console.log(stitch.stdout);
  console.log(`→ ${path.relative(ROOT, PRINT_PNG)}`);
  console.log(`→ ${path.relative(ROOT, OUT_DIR)} (${notes.length} notes)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
