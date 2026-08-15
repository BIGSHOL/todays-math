/**
 * 트랙 D 판정 결과를 **다른 워크트리로 넘길 수 있게** 커밋 가능한 파일로 내보낸다.
 *
 * `scripts/qa/reports/` 는 통째로 gitignore 대상이라 그대로는 못 넘긴다. 코디네이터가
 * 폐기 후보 대조를 자기 워크트리(`handoff-a-index`)에서 돌리려면 이 목록이 필요하다.
 *
 * 본문은 싣지 않는다(tracks/README §4). 행을 되짚을 열쇠와 판정 사유만 담는다.
 * 열쇠는 `id`(uuid)와 `externalId` 둘 다 넣는다 — `externalId` 형식을 가정하는 코드가
 * 다른 트랙의 쓰기로 깨진 적이 있어(코디네이터 2026-08-16) 한쪽만 두면 위험하다.
 *
 *   npx tsx scripts/qa/export-verdict-list.ts
 *   → scripts/qa/handoff/hwp-verdict-list.json  (커밋된다 — 다른 워크트리가 읽는다)
 */
import { readFile, writeFile } from "node:fs/promises";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const OUT = "scripts/qa/handoff/hwp-verdict-list.json";

async function main(): Promise<void> {
  const rows = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id && v.verdict !== "유지");

  const out = {
    생성시각: new Date().toISOString(),
    설명:
      "트랙 D 의 HWP 본문 교체 판정. verdict=교체 는 '적용 대기'이고 아직 DB 에 쓰지 않았다. " +
      "verdict=보류 는 HWP 쪽에도 결함이 있어 사람이 봐야 하는 것이다.",
    규칙: "scripts/qa/hwpJudgeRules.ts (S=DB 손상 사유 / H=HWP 열위 사유)",
    집계: {
      교체: rows.filter((r) => r.verdict === "교체").length,
      보류: rows.filter((r) => r.verdict === "보류").length,
    },
    rows: rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      examId: r.examId,
      n: r.n,
      verdict: r.verdict,
      S: r.S,
      H: r.H,
      sim: r.sim,
      align: r.align,
    })),
  };

  await writeFile(OUT, JSON.stringify(out), "utf-8");
  console.log(
    `판정 목록 — 교체 ${out.집계.교체} · 보류 ${out.집계.보류} → ${OUT}`,
  );
}

void main();
