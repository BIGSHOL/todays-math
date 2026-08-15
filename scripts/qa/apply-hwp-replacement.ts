/**
 * 트랙 D — 판정이 「교체」인 행의 **본문만** HWP 원본으로 바꾼다.
 *
 *   npx tsx scripts/qa/apply-hwp-replacement.ts                               드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-hwp-replacement.ts --apply  실제 적용
 *
 * ## 지키는 것
 *
 * 1. **드라이런이 기본.** `--apply` 와 `ALLOW_SHARED_IMPORT=1` 이 **둘 다** 있어야 쓴다.
 *    게이트는 PrismaClient 를 만들기 **전에** 본다(tracks/README §2).
 * 2. **되돌릴 수 있어야 한다.** 쓰기 직전에 그 행들의 현재 `content`·`problemType` 을
 *    통째로 떠 둔다(`backup-transformed-content.ts` 가 선례). 백업 파일이 안 써지면
 *    한 행도 건드리지 않는다.
 * 3. **내 컬럼만 쓴다** — `content`, (옵션) `problemType`. `answer` 는 트랙 B,
 *    `figureUrls` 는 트랙 A, `externalId` 는 트랙 C 소관이라 손대지 않는다.
 * 4. **판정에 쓴 스냅샷이 낡았으면 그 행은 건너뛴다.** 공유 DB 는 트랙이 넷이 쓴다
 *    (코디네이터 2026-08-16). 판정 당시 본문과 지금 본문이 다르면 남이 고친 것이므로
 *    덮어쓰지 않고 세어서 보고한다.
 * 5. **렌더가 나빠지면 쓰지 않는다.** 교체 대상 전체의 KaTeX 실패율을 교체 전/후로
 *    재서, 후가 전보다 나쁘면 중단한다.
 *
 * `problemType` 은 `--fix-type` 을 줄 때만 바꾼다. HWP 의 `type` 은 형식 라벨
 * (객관식·서술형·단답형)이고 우리 `problemType` 은 내용 분류(계산·개념·활용·서술형)라
 * 1:1 이 아니다. **보기가 4개 이상인데 DB 가 `서술형`** 인, 라벨이 확실히 틀린 것만
 * `mapProblemType` 으로 다시 매긴다 — `convertPastExam` 이 HWP 에서 적재했을 때와 같은 값이다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { mapProblemType } from "../../src/lib/import/mapProblemType";
import { renderKatexSafe } from "../../src/lib/math/katexRender";
import { tokenizeMath } from "../../src/lib/math/segments";
import { buildHwpContent, type HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const BACKUP = "scripts/qa/reports/hwp-replace-backup.json";
const PLAN = "scripts/qa/reports/hwp-replace-plan.json";

function mathFail(text: string): { fail: number; total: number } {
  let fail = 0;
  let total = 0;
  for (const seg of tokenizeMath(text ?? "")) {
    if (seg.type === "text") continue;
    total += 1;
    if (renderKatexSafe(seg.value, seg.type === "display").includes("math-raw")) {
      fail += 1;
    }
  }
  return { fail, total };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fixType = process.argv.includes("--fix-type");

  // ── 게이트: DB 에 붙기 전에 본다 ──────────────────────────────────
  if (apply) {
    // ⚠️ `process.env.DATABASE_URL` 만 보면 안 된다 — tsx 는 `.env` 를 자동으로 읽지 않아
    // 늘 "URL 없음" 으로 떨어진다(그러면 ALLOW_SHARED_IMPORT=1 을 줘도 영원히 막힌다).
    // `inspectDatabaseTargets` 가 env → 워크트리 `.env` 순으로 해석한다 — 다른 적재
    // 스크립트가 쓰는 것과 같은 경로를 쓴다.
    const { allowSharedImport } = await import(
      "../../src/lib/import/classifyDatabaseUrl"
    );
    const { inspectDatabaseTargets } = await import("../import/resolveDbTarget");
    const target = (await inspectDatabaseTargets()).selected;
    if (!target.canMigrateOrLoad && !allowSharedImport(target)) {
      console.log(
        `차단 — ${target.reason}\n` +
          "ALLOW_SHARED_IMPORT=1 을 명시하세요. DB 에 접속하지 않고 끝냅니다.",
      );
      return;
    }
    console.log(`대상 DB — ${target.kind} (${target.host})`);
  }

  // ── 계획 세우기 (전부 로컬 파일) ───────────────────────────────────
  const verdicts = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id && v.verdict === "교체");

  const wanted = new Map<string, (typeof verdicts)[number]>();
  for (const v of verdicts) wanted.set(v.id, v);

  const snapshot = new Map<string, { content: string; problemType: string }>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (wanted.has(r.id)) {
      snapshot.set(r.id, { content: r.content, problemType: r.problemType });
    }
  }

  const hwpCache = new Map<string, HwpQ[]>();
  const plan: Array<{
    id: string;
    externalId: string | null;
    examId: string;
    n: number;
    content: string;
    problemType?: string;
    beforeType: string;
    S: string[];
  }> = [];
  let missingHwp = 0;
  const before = { fail: 0, total: 0 };
  const after = { fail: 0, total: 0 };

  for (const v of wanted.values()) {
    if (!hwpCache.has(v.examId)) {
      hwpCache.set(
        v.examId,
        JSON.parse(await readFile(`${HWP_DIR}/${v.examId}.json`, "utf-8")).questions ?? [],
      );
    }
    const q = hwpCache.get(v.examId)!.find((x) => x.number === v.hwpNumber);
    const snap = snapshot.get(v.id);
    if (!q || !snap) {
      missingHwp += 1;
      continue;
    }
    const content = buildHwpContent(q);
    if (!content.trim()) {
      missingHwp += 1;
      continue;
    }
    const b = mathFail(snap.content);
    const a = mathFail(content);
    before.fail += b.fail;
    before.total += b.total;
    after.fail += a.fail;
    after.total += a.total;

    const entry: (typeof plan)[number] = {
      id: v.id,
      externalId: v.externalId,
      examId: v.examId,
      n: v.n,
      content,
      beforeType: snap.problemType,
      S: v.S,
    };
    // 라벨이 확실히 틀린 것만: 보기가 4개 이상인데 DB 는 `서술형`.
    if (fixType && snap.problemType === "서술형" && (q.choices?.length ?? 0) >= 4) {
      entry.problemType = mapProblemType(q.type ?? undefined);
    }
    plan.push(entry);
  }

  const pct = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(2) : "0.00");
  console.log("── D-2 본문 교체 계획 ──");
  console.log(`판정 교체 ${verdicts.length}행 · 계획 ${plan.length}행 · HWP 대응 없음 ${missingHwp}`);
  console.log(
    `KaTeX 실패 — 교체 전 ${before.fail}/${before.total} (${pct(before.fail, before.total)}%) → ` +
      `교체 후 ${after.fail}/${after.total} (${pct(after.fail, after.total)}%)`,
  );
  const typeFix = plan.filter((p) => p.problemType).length;
  if (fixType) console.log(`problemType 정정 ${typeFix}행 (서술형 → HWP 형식 라벨 기준)`);

  await mkdir("scripts/qa/reports", { recursive: true });
  await writeFile(
    PLAN,
    JSON.stringify(
      plan.map((p) => ({ ...p, content: undefined, contentLen: p.content.length })),
      null,
      1,
    ),
    "utf-8",
  );
  console.log(`계획 요약 → ${PLAN}`);

  // 렌더가 나빠지면 멈춘다. 지면이 지금보다 나빠지는 교체는 하지 않는다.
  const worse = after.total > 0 && after.fail / after.total > before.fail / Math.max(1, before.total);
  if (worse) {
    console.log("\n중단 — 교체 후 KaTeX 실패율이 더 높습니다. 규칙을 먼저 고치세요.");
    return;
  }

  if (!apply) {
    console.log("\n드라이런 — 변경 없음. 적용하려면 ALLOW_SHARED_IMPORT=1 ... --apply");
    return;
  }

  // ── 적용 ──────────────────────────────────────────────────────────
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const ids = plan.map((p) => p.id);
    const current = new Map<string, { content: string; problemType: string }>();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await prisma.problem.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: { id: true, content: true, problemType: true },
      });
      for (const r of rows) current.set(r.id, r);
    }

    // 백업이 먼저다. 못 쓰면 한 행도 건드리지 않는다.
    await writeFile(
      BACKUP,
      JSON.stringify(
        {
          takenAt: new Date().toISOString(),
          note: "트랙 D 본문 교체 직전 상태. 되돌리려면 이 content/problemType 를 그대로 되쓴다.",
          rows: [...current.entries()].map(([id, r]) => ({ id, ...r })),
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`백업 ${current.size}행 → ${BACKUP}`);

    let updated = 0;
    let skippedStale = 0;
    let skippedGone = 0;
    for (const p of plan) {
      const now = current.get(p.id);
      if (!now) {
        skippedGone += 1;
        continue;
      }
      // 판정에 쓴 본문과 지금 본문이 다르면 남의 트랙이 고친 것이다 — 덮지 않는다.
      if (now.content !== snapshot.get(p.id)!.content) {
        skippedStale += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: p.id },
        data: {
          content: p.content,
          ...(p.problemType ? { problemType: p.problemType } : {}),
        },
      });
      updated += 1;
    }
    console.log(
      `적용 ${updated}행 · 스냅샷 이후 남이 고침 ${skippedStale} · 행 없음 ${skippedGone}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
