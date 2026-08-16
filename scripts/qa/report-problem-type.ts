/**
 * 트랙 D — `problemType` 을 HWP 정본으로 바로잡을 때 **무엇이 어디로 가는지** 미리 센다.
 *
 * 본문 교체와 같은 실행에 섞지 않는다(코디네이터 조건, 2026-08-16). 어느 쪽이 무엇을
 * 바꿨는지 못 가르게 되기 때문이다. 이 스크립트는 **읽기만 한다 — 아무것도 쓰지 않는다.**
 *
 * 두 축을 대조한다.
 *   DB `problemType` : 계산 / 개념 / 활용 / 서술형   (내용 분류)
 *   HWP `type`       : 객관식 / 단답형 / 서술형        (형식 라벨)
 *
 * 둘은 1:1 이 아니다. 그래서 **형식이 확실히 어긋난 것만** 후보로 본다 —
 * 보기가 4개 이상(=객관식)인데 DB 가 `서술형` 인 행. 나머지는 손대면 안 된다.
 *
 *   npx tsx scripts/qa/report-problem-type.ts
 */
import { readFile } from "node:fs/promises";
import { mapProblemType } from "../../src/lib/import/mapProblemType";
import type { HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";

async function main(): Promise<void> {
  // 판정 대상 행의 현재 problemType 은 **DB 에서 직접** 읽는다.
  // 로컬 스냅샷은 적재 전 값이라 지금과 다를 수 있다.
  const verdicts = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const ids = verdicts.map((v) => v.id);
  const cur = new Map<string, string>();
  try {
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of await prisma.problem.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: { id: true, problemType: true },
      })) {
        cur.set(r.id, r.problemType);
      }
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

  /** DB problemType × HWP type 교차표. */
  const cross = new Map<string, number>();
  const dbDist = new Map<string, number>();
  const hwpDist = new Map<string, number>();
  /** 형식이 확실히 어긋난 것: 보기 4개 이상인데 DB 가 `서술형`. */
  const candidates = new Map<string, number>();
  /** 반대 방향: DB 는 서술형이 아닌데 HWP 는 서술형이고 보기가 없다. */
  const reverse = new Map<string, number>();
  let paired = 0;

  for (const v of verdicts) {
    const q = (await load(v.examId)).get(v.hwpNumber);
    const db = cur.get(v.id);
    if (!q || !db) continue;
    paired += 1;
    const hwp = q.type ?? "기타";
    const choices = q.choices?.length ?? 0;
    dbDist.set(db, (dbDist.get(db) ?? 0) + 1);
    hwpDist.set(hwp, (hwpDist.get(hwp) ?? 0) + 1);
    const key = `${db} × ${hwp}`;
    cross.set(key, (cross.get(key) ?? 0) + 1);

    if (db === "서술형" && choices >= 4) {
      const to = mapProblemType(q.type ?? undefined);
      candidates.set(`서술형 → ${to}`, (candidates.get(`서술형 → ${to}`) ?? 0) + 1);
    }
    if (db !== "서술형" && hwp === "서술형" && choices === 0) {
      reverse.set(`${db} → 서술형`, (reverse.get(`${db} → 서술형`) ?? 0) + 1);
    }
  }

  const show = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");

  console.log("── problemType 대조 (읽기 전용 — 아무것도 쓰지 않았다) ──");
  console.log(`대응쌍 ${paired}행`);
  console.log(`DB  problemType : ${show(dbDist)}`);
  console.log(`HWP type(형식)  : ${show(hwpDist)}`);
  console.log("\n교차표 (DB × HWP):");
  for (const [k, n] of [...cross.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
  console.log(
    `\n**정정 후보(보기 4개↑ 인데 DB 가 서술형)** : ${show(candidates) || "0"}`,
  );
  console.log(
    `참고 — 반대 방향(DB 는 서술형 아님 · HWP 서술형 · 보기 없음): ${show(reverse) || "0"}`,
  );
  console.log(
    "\n⚠️ 반대 방향은 **후보로 넣지 않았다.** HWP 의 `서술형` 은 본문에 `[서술형 N]`" +
      " 머리표가 있으면 붙는 라벨이고, 그건 원본 시험지의 **배점 구획 머리표**라" +
      " 답의 형태와 무관하다(10-handoff: 5,310건 중 95%가 그랬다).",
  );
}

void main();
