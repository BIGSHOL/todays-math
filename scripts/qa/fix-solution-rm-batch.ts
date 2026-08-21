/**
 * 해설 `rm` 잔재 일괄 수리 — HWP `rm`(roman) 명령이 날 글자로 남은 부류 (2026-08-21).
 *
 *   npx tsx --env-file=.env scripts/qa/fix-solution-rm-batch.ts            # dry-run
 *   ALLOW_RM_FIX=1 npx tsx --env-file=.env scripts/qa/fix-solution-rm-batch.ts   # 실쓰기
 *   ALLOW_RM_FIX=1 npx tsx ... --revert                                    # 되돌리기
 *
 * 원장님 검수 지적(J30602-VMC9 `$rmRHS$합동`)에서 출발 — 같은 부류를 전량 열거해
 * (589행·199패턴, `rm-enum` 산출) 눈으로 보고 규칙을 좁혔다.
 *
 * 규칙 (보수적 — 못 가르는 것은 남긴다):
 *  1. `boldrm{대문자런}` → `\mathbf{…}`   (HWP `bold rm X`)
 *  2. `rmrm{대문자런}`   → `\mathrm{…}`   (이중 rm 오타)
 *  3. (비영문자·비역슬래시 뒤) `rm{대문자로 시작하는 영숫자'런}` → `\mathrm{…}`
 *     — 앞이 영문자면 건드리지 않는다: `\mathrm` 의 `h`+`rm` 이 자동 보호된다.
 *     — 소문자로 시작하는 `rmml`·`rmkg` 류는 영어 단어와 못 갈라 **안 건드린다**.
 *
 * 가드 (이 저장소의 교훈 그대로):
 *  · 치환이 **수식(`$…$`) 안**에 있을 때만 — 밖이면 renderMathHtml 이 백슬래시를
 *    이스케이프해 날 것으로 나간다(2026-08-19). 밖이면 그 행은 통째로 건너뛰고 기록.
 *  · 숫자 열이 한 글자라도 변하면 그 행을 버린다.
 *  · 바뀐 수식 조각을 KaTeX 로 실렌더 — 에러(#cc0000/katex-error)면 그 행을 버린다.
 *  · 원장(before/after 전량)을 먼저 쓰고 DB 를 바꾼다. 원장이 이미 있으면 멈춘다.
 *  · 되돌리기는 지금 값이 내가 쓴 after 일 때만 before 로 되돌린다(2026-08-18).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import katex from "katex";

const APPLY = process.env.ALLOW_RM_FIX === "1";
const REVERT = process.argv.includes("--revert");
const LEDGER = path.join(
  "scripts",
  "qa",
  "reports",
  "solution-rm-batch-2026-08-21.json",
);

const p = new PrismaClient();

/** 대문자로 시작하는 영숫자(') 런 — HWP rm 인자의 실측 모양. */
const RUN = "[A-Z][A-Za-z0-9']*";

function convert(s: string): string {
  let out = s.replace(
    new RegExp(`boldrm(${RUN})`, "g"),
    (_m, r: string) => `\\mathbf{${r}}`,
  );
  out = out.replace(
    new RegExp(`rmrm(${RUN})`, "g"),
    (_m, r: string) => `\\mathrm{${r}}`,
  );
  out = out.replace(
    new RegExp(`(^|[^A-Za-z\\\\])rm(${RUN})`, "g"),
    (_m, pre: string, r: string) => `${pre}\\mathrm{${r}}`,
  );
  return out;
}

/** i 번째 위치가 $…$ 수식 안인가 — 그 앞의 $ 개수가 홀수면 안이다. */
function insideMath(s: string, i: number): boolean {
  let n = 0;
  for (let k = 0; k < i; k += 1) if (s[k] === "$") n += 1;
  return n % 2 === 1;
}

/** 바뀐 자리 전부가 수식 안인가. */
function allChangesInsideMath(before: string): boolean {
  const re = new RegExp(
    `boldrm${RUN}|rmrm${RUN}|(^|[^A-Za-z\\\\])rm${RUN}`,
    "g",
  );
  for (const m of before.matchAll(re)) {
    const at =
      m[0].startsWith("rm") || m[0].startsWith("bold")
        ? m.index!
        : m.index! + 1;
    if (!insideMath(before, at)) return false;
  }
  return true;
}

const digits = (s: string) => s.replace(/[^0-9]/g, "");

/** 바뀐 뒤의 수식 조각들을 실렌더 — 실패 신호가 있으면 false. */
function rendersClean(after: string): boolean {
  const segs = after.match(/\$[^$]*\\math(?:rm|bf)\{[^$]*\$/g) ?? [];
  for (const seg of segs) {
    const body = seg.slice(1, -1);
    try {
      const html = katex.renderToString(body, { throwOnError: false });
      if (html.includes("katex-error") || html.includes("#cc0000"))
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function main() {
  if (REVERT) {
    if (!existsSync(LEDGER)) throw new Error("원장이 없다: " + LEDGER);
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      rows: Array<{ id: string; before: string; after: string }>;
    };
    let reverted = 0;
    let skipped = 0;
    for (const r of ledger.rows) {
      const cur = await p.problem.findUnique({
        where: { id: r.id },
        select: { solution: true },
      });
      if (cur?.solution === r.after) {
        if (APPLY)
          await p.problem.update({
            where: { id: r.id },
            data: { solution: r.before },
          });
        reverted += 1;
      } else skipped += 1;
    }
    console.log(
      `되돌림 ${reverted} · 건너뜀(딴 값) ${skipped}${APPLY ? "" : " [dry-run]"}`,
    );
    return;
  }

  if (existsSync(LEDGER))
    throw new Error(
      "원장이 이미 있다 — 두 번째 실행은 덮어쓰기가 된다. 먼저 확인하라: " +
        LEDGER,
    );

  const rows = await p.$queryRawUnsafe<
    Array<{
      id: string;
      problem_code: string | null;
      solution: string;
      direct_use_allowed: boolean;
    }>
  >(
    `SELECT id, problem_code, solution, direct_use_allowed FROM problem WHERE solution ~ '(boldrm|rmrm|rm)[A-Z]'`,
  );
  console.log(
    "대상(전체):",
    rows.length,
    "· 출제 가능:",
    rows.filter((r) => r.direct_use_allowed).length,
  );

  const changed: Array<{
    id: string;
    code: string | null;
    before: string;
    after: string;
  }> = [];
  const skippedOutside: string[] = [];
  const skippedDigits: string[] = [];
  const skippedRender: string[] = [];

  for (const r of rows) {
    const after = convert(r.solution);
    if (after === r.solution) continue;
    if (!allChangesInsideMath(r.solution)) {
      skippedOutside.push(r.problem_code ?? r.id);
      continue;
    }
    if (digits(after) !== digits(r.solution)) {
      skippedDigits.push(r.problem_code ?? r.id);
      continue;
    }
    if (!rendersClean(after)) {
      skippedRender.push(r.problem_code ?? r.id);
      continue;
    }
    changed.push({ id: r.id, code: r.problem_code, before: r.solution, after });
  }

  console.log(
    `바꿀 행 ${changed.length} · 수식 밖 건너뜀 ${skippedOutside.length} · 숫자 변화 건너뜀 ${skippedDigits.length} · 렌더 실패 건너뜀 ${skippedRender.length}`,
  );
  if (skippedOutside.length)
    console.log("  수식 밖:", skippedOutside.slice(0, 20).join(", "));
  if (skippedDigits.length) console.log("  숫자:", skippedDigits.join(", "));
  if (skippedRender.length) console.log("  렌더:", skippedRender.join(", "));

  // 표본 — 다양한 패턴 10건을 눈으로 볼 수 있게 찍는다
  for (const c of changed.slice(0, 6)) {
    const i = c.before.search(/(boldrm|rmrm|rm)[A-Z]/);
    console.log(
      `  예) ${c.code}: …${c.before.slice(Math.max(0, i - 18), i + 22)}… → …${c.after.slice(Math.max(0, i - 18), i + 30)}…`,
    );
  }

  if (!APPLY) {
    console.log("[dry-run] 실쓰기는 ALLOW_RM_FIX=1");
    return;
  }

  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note: "해설 rm 잔재 일괄 (원장님 검수 지적 2026-08-21). 규칙·가드는 fix-solution-rm-batch.ts 머리주석.",
        rows: changed.map(({ id, before, after }) => ({ id, before, after })),
      },
      null,
      1,
    ),
    "utf8",
  );

  let applied = 0;
  for (const c of changed) {
    await p.problem.update({
      where: { id: c.id },
      data: { solution: c.after },
    });
    applied += 1;
  }
  console.log("적용:", applied, "· 원장:", LEDGER);

  // 사후 감사 — DB 를 다시 읽어 잔재를 다시 센다 (계획이 아니라 DB 를 본다)
  const residue = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) n FROM problem WHERE solution ~ '(^|[^a-zA-Z])rm[A-Z]'`,
  );
  console.log(
    "사후 잔재(비영문자 뒤 rm+대문자):",
    Number(residue[0]!.n),
    "건 (건너뛴 행들이 남는 게 정상)",
  );
}

main().finally(() => p.$disconnect());
