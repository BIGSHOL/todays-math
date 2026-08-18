/**
 * 넘침 문항의 **본문 오염**을 걷어 내는 안 — **드라이런 전용. 쓰기 경로가 없다.**
 *
 *   npx tsx scripts/qa/fix-oversize-contamination.ts
 *   npx tsx scripts/qa/fix-oversize-contamination.ts --measure   # 고친 본문을 실제로 그려 잰다
 *
 * ## 왜 쓰기 경로가 아예 없나
 *
 * 공유 DB(D-31)이고, 본문을 고치는 것은 원장님 확정 사항이다. 여기서는
 * **무엇을 어떻게 고칠 것인지와 그 값**만 낸다. 산출물 JSON 은 행마다 `before` 를
 * 통째로 담고 있어 **그 자체가 되돌리기 자료**다 (`--apply` 를 만들 때 이 파일을
 * 그대로 역으로 쓰면 된다).
 *
 * ## 규칙마다 가드가 붙어 있다
 *
 * CLAUDE.md 가 아홉 번 적은 함정 — 「손상이 심할수록 그 손상을 정상으로 읽는 가드가
 * 생긴다」. 여기서 위험한 방향은 **반대**다: 오염을 지우는 규칙이 멀쩡한 수식을
 * 먹는 것. 그래서 규칙마다
 *   · 지운 양이 오염이라고 볼 만큼 큰가 (조금만 걸리면 그건 오염이 아니다)
 *   · 지운 뒤 오염 신호가 실제로 사라졌는가
 * 를 **둘 다** 확인하고, 하나라도 어긋나면 그 행은 «못 고침»으로 낸다.
 * 2026-08-18 `le`/`ge` 사건처럼 「전량 확인」이 한 컬럼 안에서만 전량이면 안 되므로,
 * 후보를 고를 때 넘침 문항이 아니라 **DB 전량**을 훑어 오탐을 함께 센다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import { readSignals } from "./oversizeRules";
import {
  GUARD_SCRIPT,
  assertPaperSane,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  school: string | null;
  examId: string | null;
  questionNumber: number | null;
}

/**
 * base64 덩어리 토큰. 원문은 `$<base64>$=` 꼴로 **수식 안에 통째로** 들어와 있다.
 * 안에 백슬래시·중괄호·공백이 하나도 없어야 하므로 실수식과 겹치지 않는다.
 */
const BASE64_TOKEN = /\$[A-Za-z0-9+/=]{40,}\$={0,2}/g;
/**
 * 지운 자리에 남는 **홑 등호 찌꺼기**. 처음엔 꼬리 `=` 를 하나만 먹는 규칙이라
 * `$…$==` 짜리에서 등호가 하나씩 남았다 — 남은 줄이 `=는 수,` 처럼 보인다.
 * 규칙을 고친 뒤에도 **세어서 보고한다**: 안 세면 다음번 변종도 조용히 남는다.
 */
const STRAY_EQUALS = /(?:^|\s)={1,2}(?=\s|$|[가-힣])/g;
/** `[11~12]` 같은 묶음 지시문 — 이 뒤는 **다음 문항들**의 것이다. */
const BUNDLE_HEAD = /\[\s*\$?\d+\$?\s*~\s*\$?\d+\$?\s*\]/;
/** 시험지 머리말이 들어 있는 **줄** 하나. */
const HEADER_LINE = /^.*\d{2,4}\s*년\s*\d\s*학기\s*(?:중간|기말)\s*고?사.*$/gm;

export type FixKind = "base64" | "묶음지시문 꼬리" | "시험지 머리말 줄";

export interface Fix {
  kind: FixKind;
  after: string;
  removed: number;
  note: string;
}

/** 규칙 하나하나가 «고칠 수 있으면 결과, 아니면 null» 을 낸다. */
export function fixBase64(content: string): Fix | null {
  const after = content.replace(BASE64_TOKEN, "");
  const removed = content.length - after.length;
  // 가드 1 — 조금만 걸리면 오염이 아니다(정상 수식을 갉는 쪽이 훨씬 나쁘다).
  if (removed < content.length * 0.3) return null;
  // 가드 2 — 지운 뒤에도 base64 덩어리가 남아 있으면 규칙이 부분만 아는 것이다.
  const leftovers: string[] = [];
  if (readSignals(after).base64Runs > 0)
    leftovers.push("base64 덩어리가 남는다");
  // 가드 3 — 지운 자리에 등호 찌꺼기가 남았는가.
  const strayBefore = (content.match(STRAY_EQUALS) ?? []).length;
  const strayAfter = (after.match(STRAY_EQUALS) ?? []).length;
  if (strayAfter > strayBefore)
    leftovers.push(`등호 찌꺼기 ${strayAfter - strayBefore}개`);
  return {
    kind: "base64",
    after,
    removed,
    note: leftovers.length ? `규칙이 모자라다: ${leftovers.join(" · ")}` : "",
  };
}

export function fixBundleTail(content: string): Fix | null {
  const m = BUNDLE_HEAD.exec(content);
  if (!m || m.index === undefined) return null;
  // 가드 - 본문 앞머리에 있으면 **이 문항 자신의** 묶음 지시문이다. 자르면 안 된다.
  if (m.index < content.length * 0.2) return null;
  const after = content.slice(0, m.index).trimEnd();
  return {
    kind: "묶음지시문 꼬리",
    after,
    removed: content.length - after.length,
    note: "",
  };
}

export function fixHeaderLine(content: string): Fix | null {
  HEADER_LINE.lastIndex = 0;
  const hits = [...content.matchAll(HEADER_LINE)];
  if (hits.length === 0) return null;
  const after = content
    .replace(HEADER_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return {
    kind: "시험지 머리말 줄",
    after,
    removed: content.length - after.length,
    note: hits.map((h) => h[0].trim().slice(0, 60)).join(" | "),
  };
}

const RULES: ((content: string) => Fix | null)[] = [
  fixBase64,
  fixBundleTail,
  fixHeaderLine,
];

/**
 * 고친 본문을 **지면에 그려** 높이를 잰다. 지면 원문은 한 줄도 안 바꾼다 —
 * 바뀌는 것은 문항 본문뿐이라 실측 칸(484px)과 자가 그대로다.
 * ⚠️ 장마다 **두 문항**을 넣는다. 하나만 넣으면 칸이 두 배가 되어 다른 것을 잰다.
 */
async function measureContents(
  rows: Array<{ id: string; content: string; figureUrls: string[] }>,
  figuresById: Map<string, string[]>,
): Promise<Map<string, number>> {
  const filled = [...rows];
  if (filled.length % 2 === 1)
    filled.push({ id: "__filler__", content: "", figureUrls: [] });
  const pages: string[] = [];
  for (let i = 0; i < filled.length; i += 2)
    pages.push(
      renderPage(
        "continuation",
        filled.slice(i, i + 2).map((r, j) =>
          renderSlot(
            {
              id: r.id,
              content: r.content,
              figureUrls: figuresById.get(r.id) ?? [],
            },
            i + j + 1,
          ),
        ),
        2,
      ),
    );
  const url = writeProbe("probe-fix.html", await paperDocument(pages));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));
    const measured = (await page.evaluate(() => {
      const out: [string, number][] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        out.push([
          (item as HTMLElement).dataset.pid ?? "",
          blank.getBoundingClientRect().bottom -
            num.getBoundingClientRect().top,
        ]);
      });
      return out;
    })) as [string, number][];
    return new Map(measured);
  } finally {
    await browser.close();
  }
}

async function main() {
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]!
    : "scripts/qa/reports/oversize-content-fix.json";

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, school, exam_id AS "examId", question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const fixes: Array<{
    id: string;
    kind: FixKind;
    before: string;
    after: string;
    removed: number;
    note: string;
    school: string | null;
    examId: string | null;
    questionNumber: number | null;
  }> = [];

  for (const row of rows) {
    for (const rule of RULES) {
      const fix = rule(row.content ?? "");
      if (!fix) continue;
      fixes.push({
        id: row.id,
        kind: fix.kind,
        before: row.content,
        after: fix.after,
        removed: fix.removed,
        note: fix.note,
        school: row.school,
        examId: row.examId,
        questionNumber: row.questionNumber,
      });
    }
  }

  const byKind = new Map<FixKind, typeof fixes>();
  for (const f of fixes) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  console.log(
    `DB 전량 ${rows.length.toLocaleString()}건을 훑었다 (넘침만이 아니다).`,
  );
  for (const [kind, list] of byKind) {
    const bad = list.filter((f) => f.note.includes("모자라"));
    console.log(
      `  ${kind}: ${list.length}건 · 지운 글자 중앙 ${
        [...list].map((f) => f.removed).sort((a, b) => a - b)[
          Math.floor(list.length / 2)
        ]
      }자${bad.length ? ` · ⚠️ 규칙이 모자란 행 ${bad.length}` : ""}`,
    );
  }

  /* 고친 본문이 **실제로 몇 px 가 되는가** — 추정하지 말고 그려서 잰다. */
  if (process.argv.includes("--measure")) {
    const cache = JSON.parse(
      readFileSync(".measure/cont.json", "utf8"),
    ) as Array<{ pid: string; neededPx: number }>;
    const before = new Map(cache.map((m) => [m.pid, m.neededPx]));
    const targets = fixes.filter((f) => (before.get(f.id) ?? 0) > 997);
    console.log(
      `\n넘침(>997px)인 것 ${targets.length}건을 고친 본문으로 다시 그려 잰다.`,
    );
    const measured = await measureContents(
      targets.map((f) => ({ id: f.id, content: f.after, figureUrls: [] })),
      new Map(
        (
          (await prisma.$queryRawUnsafe(
            `SELECT id, figure_urls AS "figureUrls" FROM problem WHERE id = ANY($1::uuid[])`,
            targets.map((f) => f.id),
          )) as Array<{ id: string; figureUrls: string[] }>
        ).map((r) => [r.id, r.figureUrls]),
      ),
    );
    for (const f of targets) {
      const now = before.get(f.id)!;
      const after = measured.get(f.id);
      console.log(
        `  ${f.id.slice(0, 8)} ${f.school ?? "?"} ${f.questionNumber ?? "?"}번 [${f.kind}] ${now.toFixed(0)}px -> ${after?.toFixed(0) ?? "?"}px` +
          (after !== undefined && after <= 484
            ? "  (보통 칸에 들어간다)"
            : after !== undefined && after <= 997
              ? "  (혼자 쓰는 칸에는 들어간다)"
              : "  (여전히 어느 칸에도 안 들어간다)"),
      );
    }
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(fixes, null, 1), "utf8");
  console.log(
    `\n-> ${outPath}\n   (행마다 before 를 통째로 담았다 - 이 파일이 곧 되돌리기 자료다)`,
  );
  console.log("적용하지 않았다. 이 스크립트에는 쓰기 경로가 없다.");
}

if (process.argv[1]?.includes("fix-oversize-contamination"))
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
