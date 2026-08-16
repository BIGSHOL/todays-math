/**
 * 원장님 결정 자료 — DB 가 `서술형` 인데 시험지 자신은 `[단답형]`·`[서답형]` 로 표시한
 * 1,309행을 어떻게 할 것인가.
 *
 * **읽기만 한다 — 아무것도 쓰지 않는다.**
 *
 * 코드 전수 확인(2026-08-16)으로 밝힌 사실:
 *   출제 자격 `findEligibleProblems`  — problemType 을 **안 본다**
 *   문항 선정 `balanceDifficulty`      — 유형 사용 빈도가 낮은 쪽을 우선(구성이 바뀐다)
 *   배치 순서 `arrangeByType`          — 같은 유형 3연속 회피(순서가 바뀐다)
 *   채점     `gradeAnswers`            — problemType 을 **안 본다**
 *
 *   npx tsx scripts/qa/report-essay-shortanswer.ts
 */
import { readFile } from "node:fs/promises";

import { mapProblemType } from "../../src/lib/import/mapProblemType";
import type { HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const MISSING_ANSWER = "(정답 없음)";

/** 정답 표기가 '최종 값' 인가 '풀이 참조' 인가. 채점 가능성의 실질 판단 기준이다. */
const REF_ONLY = /^(해설\s*참조|풀이\s*참조|풀이참조|해설참조)$/;

async function main(): Promise<void> {
  const verdicts = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const rows = new Map<
    string,
    {
      problemType: string;
      answer: string;
      reviewStatus: string;
      directUseAllowed: boolean;
      score: number | null;
      difficulty: string;
      school: string | null;
      questionNumber: number | null;
      unitId: string;
    }
  >();
  const unitName = new Map<string, string>();
  try {
    const ids = verdicts.map((v) => v.id);
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of await prisma.problem.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: {
          id: true, problemType: true, answer: true, reviewStatus: true,
          directUseAllowed: true, score: true, difficulty: true,
          school: true, questionNumber: true, unitId: true,
        },
      })) {
        rows.set(r.id, r);
      }
    }
    for (const u of await prisma.unit.findMany({
      select: { id: true, grade: true, section: true },
    })) {
      unitName.set(u.id, `${u.grade} / ${u.section}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  const hwpCache = new Map<string, Map<number, HwpQ>>();
  const load = async (eid: string) => {
    if (!hwpCache.has(eid)) {
      const qs: HwpQ[] = JSON.parse(
        await readFile(`${HWP_DIR}/${eid}.json`, "utf-8"),
      ).questions ?? [];
      hwpCache.set(eid, new Map(qs.map((q) => [q.number, q])));
    }
    return hwpCache.get(eid)!;
  };

  const t = {
    대상: 0,
    현재_출제가능: 0,
    정답없음: 0,
    풀이참조: 0,
    승인아님: 0,
    직접사용불가: 0,
    배점있음: 0,
    라벨_단답형: 0,
    라벨_서답형: 0,
    라벨_없음: 0,
    바뀔값: mapProblemType("단답형"),
  };
  const sampledExams = new Set<string>();
  const samples: Array<{
    label: string;
    unit: string;
    score: number | null;
    ansKind: string;
    hwpLabel: string;
    eligible: boolean;
  }> = [];

  for (const v of verdicts) {
    const db = rows.get(v.id);
    if (!db || db.problemType !== "서술형") continue;
    const q = (await load(v.examId)).get(v.hwpNumber);
    if (!q || q.type !== "단답형") continue;
    t.대상 += 1;

    const ans = (db.answer ?? "").trim();
    const noAns = ans === MISSING_ANSWER || ans === "";
    const refOnly = REF_ONLY.test(ans);
    if (noAns) t.정답없음 += 1;
    if (refOnly) t.풀이참조 += 1;
    if (db.reviewStatus !== "approved") t.승인아님 += 1;
    if (!db.directUseAllowed) t.직접사용불가 += 1;
    if (db.score != null) t.배점있음 += 1;
    // 지금 출제 풀에 실제로 잡히는가 — findEligibleProblems 의 조건 그대로.
    const eligible =
      db.reviewStatus === "approved" && db.directUseAllowed && !noAns;
    if (eligible) t.현재_출제가능 += 1;

    const lbl = q.label ?? "";
    if (lbl.includes("단답")) t.라벨_단답형 += 1;
    else if (lbl.includes("서답")) t.라벨_서답형 += 1;
    else t.라벨_없음 += 1;

    // 표본은 **서로 다른 시험지**에서 고른다. 한 편에서 몰아 뽑으면 그 편의 특성이
    // 전체인 것처럼 보인다(처음 뽑았을 때 5건 중 4건이 같은 학교였다).
    if (samples.length < 5 && eligible && !refOnly && !noAns && !sampledExams.has(v.examId)) {
      sampledExams.add(v.examId);
      samples.push({
        label: `${db.school ?? "?"} ${v.examId}-${db.questionNumber ?? v.n}번`,
        unit: unitName.get(db.unitId) ?? "?",
        score: db.score,
        ansKind:
          ans.length <= 12 ? `짧은 값 "${ans}"` : `${ans.length}자 서술`,
        hwpLabel: lbl || "(머리표 없음)",
        eligible,
      });
    }
  }

  const pct = (a: number) => ((a * 100) / Math.max(1, t.대상)).toFixed(1);
  console.log("── 서술형 × 단답형 결정 자료 (읽기 전용) ──");
  console.log(`대상 ${t.대상}행 · 바꾼다면 서술형 → ${t.바뀔값}`);
  console.log("\n[지금 어떻게 취급되나]");
  console.log(`  출제 풀에 **이미 잡힌다**  ${t.현재_출제가능} (${pct(t.현재_출제가능)}%)`);
  console.log(`  정답 없어 제외            ${t.정답없음} (${pct(t.정답없음)}%)`);
  console.log(`  승인 아님 / 직접사용 불가  ${t.승인아님} / ${t.직접사용불가}`);
  console.log(`  정답이 '풀이참조'          ${t.풀이참조}`);
  console.log(`  배점 보유                 ${t.배점있음} (${pct(t.배점있음)}%)`);
  console.log("\n[시험지 자신의 머리표]");
  console.log(`  [단답형] ${t.라벨_단답형} · [서답형] ${t.라벨_서답형} · 없음 ${t.라벨_없음}`);
  console.log("\n[표본 5건 — 본문 없이]");
  for (const s of samples) {
    console.log(
      `  · ${s.label} · ${s.unit} · 배점 ${s.score ?? "-"} · 정답 ${s.ansKind} · 시험지 머리표 ${s.hwpLabel}`,
    );
  }
}

void main();
