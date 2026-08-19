/**
 * 풀어 놓은 답안 파일 → `Problem.answer` 적재.
 *
 * 입력: `scripts/qa/reports/answer-solved/*.json`
 *   [{ "id": "<uuid>", "answer": "③", "ok": true }, …]
 *   `ok:false` 또는 `answer` 가 비면 건너뛴다(훼손·풀이 불가).
 *
 * 원장님 확정(2026-08-15): 객관식은 **번호**로, 검수 없이 **즉시 출제 가능**.
 * 그래서 `reviewStatus` 는 건드리지 않는다 — 이관분은 이미 approved 다.
 *
 * 센티널 `(정답 없음)` 인 행만 덮어쓴다. 이미 정답이 있는 행은 손대지 않는다
 * — 원본 정답이 AI 풀이보다 항상 우선이다.
 *
 *   npx tsx scripts/qa/load-answer-backfill.ts                드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-answer-backfill.ts --apply
 */
import { readdir, readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { ANSWER_CIRCLED_CLASS } from "../../src/lib/math/circledNumber";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DIR = process.env.ANSWER_SOLVED_DIR ?? "scripts/qa/reports/answer-solved";
const SENTINEL = "정답 없음";
/**
 * 정답란에 들어갈 수 있는 최대 길이.
 *
 * 300자는 "DB 가 감당하는 길이" 였지 **지면에 들어가는 길이**가 아니다.
 * 증명·설명형 문항을 푼 담당자들이 "최종 값이 없어 핵심 결론을 한 줄로
 * 적었다" 고 보고했는데, 그런 서술이 정답란에 인쇄되면 지면이 깨진다.
 * 실측(2026-08-15): 그림 배치 2,272건 중 60자 초과 180건, 120자 초과 46건,
 * 최대 326자. 중앙값은 10자라 정상 답에는 영향이 없다.
 *
 * 걸러진 문항은 `(정답 없음)` 으로 남아 출제에서 자동 제외된다. 서술형 채점은
 * 원장님이 직접 하시는 영역이라 손실이 아니다.
 */
const MAX_ANSWER = 60;

/** `①`~`⑩` 한 글자짜리 객관식 번호 정답. */
// 계열은 `circledNumber.ts` 한 곳에서 온다.
const CIRCLED_ONLY = new RegExp(`^[${ANSWER_CIRCLED_CLASS}]$`);

interface Solved {
  id: string;
  answer?: string | null;
  ok?: boolean;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log(`답안 디렉토리가 없습니다: ${DIR}`);
    return;
  }

  const solved = new Map<string, string>();
  let skipped = 0;
  let tooLong = 0;
  for (const f of files) {
    const rows: Solved[] = JSON.parse(await readFile(`${DIR}/${f}`, "utf-8"));
    for (const r of rows) {
      const a = (r.answer ?? "").trim();
      if (r.ok === false || !a) {
        skipped += 1;
        continue;
      }
      if (a.length > MAX_ANSWER) {
        tooLong += 1;
        continue;
      }
      solved.set(r.id, a);
    }
  }

  const prisma = new PrismaClient();
  try {
    const ids = [...solved.keys()];
    const targets: Array<{ id: string; answer: string }> = [];
    let unrenderable = 0;
    for (let i = 0; i < ids.length; i += 2000) {
      const rows = await prisma.problem.findMany({
        where: { id: { in: ids.slice(i, i + 2000) } },
        select: { id: true, answer: true, content: true },
      });
      for (const row of rows) {
        // 원본 정답이 있으면 덮지 않는다.
        if (!row.answer.includes(SENTINEL)) continue;
        const answer = solved.get(row.id) as string;
        // 번호 정답은 **시험지에 보기 번호가 찍혀야** 학생이 대조할 수 있다.
        // OCR 에서 ①②③④⑤ 마커가 통째로 벗겨진 문항이 1,319건 있는데
        // (전부 transformed, 2026-08-15 실측), 거기에 "③" 을 넣으면
        // 대조할 대상이 없는 정답이 인쇄된다. 보기 마커를 복원하기 전에는
        // 넣지 않는다 — `(정답 없음)` 이면 출제에서 자동 제외돼 지금이 더 안전하다.
        if (CIRCLED_ONLY.test(answer)) {
          const parsed = parseProblemContent(row.content);
          if (!parsed.choices || parsed.choices.length < 2) {
            unrenderable += 1;
            continue;
          }
        }
        targets.push({ id: row.id, answer });
      }
    }

    console.log("── 정답 백필 적재 ──");
    console.log(
      `답안 파일 ${files.length} · 풀린 문항 ${solved.size}` +
        ` · 풀이불가 ${skipped} · 정답이 길어 제외 ${tooLong}`,
    );
    console.log(`실제 갱신 대상 ${targets.length} (이미 정답 있는 행은 제외)`);
    if (unrenderable > 0) {
      console.log(
        `  ⚠️ 보기 미렌더로 보류 ${unrenderable}` +
          " — 번호 정답인데 시험지에 보기가 안 찍히는 문항. 마커 복원 후 재실행하면 들어갑니다.",
      );
    }

    if (!apply) {
      console.log("\n드라이런 — 변경 없음. 적용하려면 --apply");
      return;
    }
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }
    let n = 0;
    for (const t of targets) {
      await prisma.problem.update({
        where: { id: t.id },
        data: { answer: t.answer },
      });
      n += 1;
    }
    console.log(`\n적재 완료 — ${n}건`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
