/**
 * 트랙 D 완료 기준 — **폐기 후보 515건 중 몇 건이 HWP 로 되살아나는가.**
 *
 * `build-discard-list.ts` 를 다시 돌릴 수가 없다. 그 입력인
 * `scripts/qa/reports/answer-solved*` 는 gitignore 대상이라 이 컴퓨터에 없다
 * (다른 컴퓨터에서 만든 산출물이다). 그래서 **커밋된 문서**
 * `docs/planning/12-discard-candidates.md` 를 읽어 문항을 되짚는다.
 *
 * 되짚는 열쇠는 `externalId` 가 아니라 **원본 경로 + 문항번호**다.
 * 코디네이터 보고(2026-08-16): `build-discard-list.ts` 가 `externalId` 를
 * `<examId>-<번호>` 로 가정했다가 트랙 C 가 RPM 행에 sumaek UUID 를 넣자 31건이
 * 조용히 '원본 미상' 이 됐다. 같은 가정을 반복하지 않는다.
 *
 *   npx tsx scripts/qa/count-discard-revival.ts
 */
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const DOC = "docs/planning/12-discard-candidates.md";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";

interface Cand {
  reason: string;
  label: string;
  n: number | null;
  path: string | null;
}

function parseDoc(md: string): Cand[] {
  const out: Cand[] = [];
  let reason = "(미분류)";
  let pending: Cand | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const head = /^##\s+(.+?)\s*\(\d+건\)\s*$/.exec(line);
    if (head) {
      reason = head[1];
      continue;
    }
    const bullet = /^-\s+\*\*(.+?)\*\*/.exec(line);
    if (bullet) {
      if (pending) out.push(pending);
      const num = /(\d+)번\s*$/.exec(bullet[1]);
      pending = {
        reason,
        label: bullet[1],
        n: num ? Number(num[1]) : null,
        path: null,
      };
      continue;
    }
    const p = /^\s+-\s+`([^`]+)`\s*$/.exec(line);
    if (p && pending && !pending.path) pending.path = p[1];
  }
  if (pending) out.push(pending);
  return out;
}

/** 경로 표기 흔들림(대소문자·`( 완료)` 공백)을 흡수한다. */
const normPath = (p: string): string =>
  p.toLowerCase().replace(/\s+/g, "").replace(/\.pdf$/, "");

async function main(): Promise<void> {
  const cands = parseDoc(await readFile(DOC, "utf-8"));
  const byKey = new Map<string, Cand[]>();
  let noPath = 0;
  for (const c of cands) {
    if (!c.path || c.n == null) {
      noPath += 1;
      continue;
    }
    const k = `${normPath(c.path)}#${c.n}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(c);
  }

  // 스냅샷에서 원본경로+번호로 행 id 를 찾는다.
  const idOf = new Map<string, string>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.source !== "past_exam" || !r.sourceFile || r.n == null) continue;
    const k = `${normPath(r.sourceFile)}#${r.n}`;
    if (byKey.has(k)) idOf.set(k, r.id);
  }

  const verdictOf = new Map<string, { verdict: string; S: string[] }>();
  for (const line of (await readFile(VERDICTS, "utf-8")).split("\n")) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    if (v.id) verdictOf.set(v.id, { verdict: v.verdict, S: v.S ?? [] });
  }

  const tally: Record<string, Record<string, number>> = {};
  const bump = (reason: string, k: string) => {
    tally[reason] ??= { 후보: 0, DB행찾음: 0, HWP판정있음: 0, 교체: 0, 보류: 0, 유지: 0 };
    tally[reason][k] += 1;
  };

  for (const [k, list] of byKey) {
    for (const c of list) {
      bump(c.reason, "후보");
      const id = idOf.get(k);
      if (!id) continue;
      bump(c.reason, "DB행찾음");
      const v = verdictOf.get(id);
      if (!v) continue;
      bump(c.reason, "HWP판정있음");
      bump(c.reason, v.verdict);
    }
  }

  const total = { 후보: 0, DB행찾음: 0, HWP판정있음: 0, 교체: 0, 보류: 0, 유지: 0 };
  console.log("── 폐기 후보 ↔ HWP 판정 ──");
  console.log("(RPM 후보는 원본 경로가 없어 애초에 대상이 아니다 — 트랙 C 소관)");
  console.log(
    `⚠️ 문서는 사유별로 최대 ${50}건만 싣는다(build-discard-list.ts 의 PER_SECTION).` +
      " 아래 '후보' 는 515건 전량이 아니라 **문서에 실린 것**의 수다.",
  );
  console.log(
    `${"사유".padEnd(14)} ${"후보".padStart(5)} ${"DB행".padStart(8)} ` +
      `${"판정".padStart(8)} ${"교체".padStart(6)} ${"보류".padStart(6)} ${"유지".padStart(6)}`,
  );
  for (const [reason, t] of Object.entries(tally)) {
    for (const k of Object.keys(total)) total[k as keyof typeof total] += t[k];
    console.log(
      `${reason.padEnd(14)} ${String(t.후보).padStart(5)} ${String(t.DB행찾음).padStart(8)} ` +
        `${String(t.HWP판정있음).padStart(8)} ${String(t.교체).padStart(6)} ` +
        `${String(t.보류).padStart(6)} ${String(t.유지).padStart(6)}`,
    );
  }
  console.log(
    `${"합계".padEnd(14)} ${String(total.후보).padStart(5)} ${String(total.DB행찾음).padStart(8)} ` +
      `${String(total.HWP판정있음).padStart(8)} ${String(total.교체).padStart(6)} ` +
      `${String(total.보류).padStart(6)} ${String(total.유지).padStart(6)}`,
  );
  console.log(`\n문서에서 원본경로·번호를 못 읽은 항목 ${noPath} (대부분 RPM)`);
}

void main();
