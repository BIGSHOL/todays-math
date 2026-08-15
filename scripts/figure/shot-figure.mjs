/**
 * 문제은행에서 **그림이 붙은 문항**을 실제로 그려 보고 스크린샷을 남긴다.
 *
 * 화면 검수용 도구다 — 뽑은 그림이 제 문항 자리에 제대로 나오는지, 크기·여백이
 * 읽을 만한지는 코드로 알 수 없다. 눈으로 봐야 한다.
 *
 * 사용: node scripts/figure/shot-figure.mjs [출력디렉터리]
 * 선행: npm run dev (localhost:3000)
 */
import { mkdir } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "out/shots";
const BASE = "http://localhost:3000";
const ACCOUNT = { email: "test_t@osu.com", password: "test1234" };

await mkdir(OUT, { recursive: true });
const db = new PrismaClient();

// 그림이 붙은 문항이 가장 많은 단원을 고른다 — 한 화면에 여러 개가 잡힌다.
const rows = await db.$queryRawUnsafe(
  `select unit_id, count(*)::int n from "problem"
   where array_length(figure_urls,1) > 0 group by unit_id order by n desc limit 1`,
);
const unitId = rows[0]?.unit_id;
const unit = await db.unit.findUnique({ where: { id: unitId } });
console.log(`대상 단원: ${unit?.grade} ${unit?.chapter} / ${unit?.section} (그림 ${rows[0]?.n}건)`);
await db.$disconnect();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

await page.goto(`${BASE}/login`);
await page.getByLabel("이메일").fill(ACCOUNT.email);
await page.getByLabel("비밀번호").fill(ACCOUNT.password);
await page.getByRole("button", { name: /로그인/ }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/problems`);
await page.waitForLoadState("networkidle");
// 단원 필터는 URL 파라미터가 아니라 화면의 select 다 — 값(unitId)으로 고른다.
await page.getByLabel("단원").selectOption(unitId);
await page.waitForLoadState("networkidle");
// 목록이 그려질 때까지 먼저 기다린다 — 바로 evaluate 하면 아직 0개다.
await page.waitForSelector('img[src*="/figures/"]', { timeout: 30000 });
// 그림이 **다 로드될 때까지** 기다린다.
// ⚠️ 고정 대기(1.5초)로 재면 아직 안 받은 이미지가 naturalWidth 0 이라
//    '깨짐'으로 잘못 잡힌다(실측 32개 오탐). complete 를 봐야 한다.
await page.evaluate(async () => {
  const figs = [...document.querySelectorAll("img")].filter((i) =>
    i.src.includes("/figures/"),
  );
  await Promise.all(
    figs.map((i) =>
      i.complete
        ? Promise.resolve()
        : new Promise((res) => {
            i.addEventListener("load", res, { once: true });
            i.addEventListener("error", res, { once: true });
          }),
    ),
  );
});

const imgs = await page.evaluate(() =>
  [...document.querySelectorAll("img")]
    .filter((i) => i.src.includes("/figures/"))
    .map((i) => ({
      src: new URL(i.src).pathname,
      w: i.naturalWidth,
      h: i.naturalHeight,
      shown: i.clientWidth,
      broken: i.naturalWidth === 0,
    })),
);

console.log(`화면의 그림 ${imgs.length}개`);
for (const i of imgs.slice(0, 8)) {
  console.log(
    `  ${i.broken ? "✗ 깨짐" : "✓"} ${i.src}  원본 ${i.w}x${i.h} → 표시폭 ${i.shown}px`,
  );
}
const broken = imgs.filter((i) => i.broken).length;
console.log(broken ? `⚠️ 깨진 그림 ${broken}개` : "깨진 그림 없음");

await page.screenshot({ path: `${OUT}/problems.png`, fullPage: false });
// 그림이 붙은 카드만 따로 — 실제로 어떻게 보이는지가 검수 대상이다.
const card = page.locator('img[src*="/figures/"]').first().locator("xpath=ancestor::article[1]");
if (await card.count()) {
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/figure-card.png` });
  console.log(`→ ${OUT}/figure-card.png`);
}
console.log(`→ ${OUT}/problems.png`);
await browser.close();
