/**
 * 트랙 «HWP 회수» — **297건을 HWP 원본에서 되찾으면 몇 건이 사는가** (읽기 전용).
 *
 *   npx tsx scripts/qa/export-rescue-pool.ts        # 공유 DB 를 **한 번만** 읽는다
 *   npx tsx scripts/qa/measure-hwp-rescue.ts
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --samples 6            부류마다 원문 표본
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --rescue 완전회복 --samples 8
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --cause "마커가 줄 중간에 붙었다" --samples 4
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --id 6e0846e4 --samples 1  그 행 하나만
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --harm --samples 20    반대쪽에서 개악된 것
 *   npx tsx scripts/qa/measure-hwp-rescue.ts --list                 전량 목록
 *
 * 입력 (전부 로컬 산출물)
 *   scripts/qa/reports/rescue-pool.jsonl    출제 가능 풀 전량 (분모)
 *   scripts/qa/reports/rescue-align.jsonl   추출한 편의 모든 past_exam 행 (정렬 닻)
 *   scripts/qa/reports/hwp-latex/<examId>.json
 *
 * 출력
 *   scripts/qa/reports/hwp-rescue.json         행 단위 결과 (본문은 안 싣는다)
 *   scripts/qa/reports/hwp-rescue-ledger.json  **커밋되는** 원장
 *
 * ## 이 자가 지키는 것 넷
 *
 * 1. **분모를 먼저 찍는다.** 공유 DB 는 움직인다. 스냅샷의 지문을 같이 싣는다.
 * 2. **팔을 갈라 잰다.** 「HWP 를 넣으면 사는가」 한 축으로 재면 **파서 결함이
 *    원본 결함으로 둔갑한다** — 실측으로 그랬다(§왜 팔이 넷인가, `hwpRescueRules.ts`).
 * 3. **처리용 모집단과 반증용 모집단을 섞지 않는다.** 회복 건수는 «치명» 안에서만
 *    세고, 「성한 문항이 깨지는가」는 **따로** 센다. 2026-08-18 에 이걸 섞어서
 *    43건이 433건이 됐다.
 * 4. **못 맞댄 것을 0으로 뭉개지 않는다.** 원본 없음·추출 실패·정렬 근거 없음을
 *    각각 세어 찍는다.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

import { isFatal, judgeAnswerChoice, type Verdict } from "./answerChoiceRules";
import { alignExam, type Align, type DbRow, type HwpQ } from "./hwpJudgeRules";
import {
  ARMS,
  familyOf,
  judgeRescue,
  type Arm,
  type Family,
  type OuterEvidence,
  type Rescue,
} from "./hwpRescueRules";

const POOL = "scripts/qa/reports/rescue-pool.jsonl";
const ALIGN = "scripts/qa/reports/rescue-align.jsonl";
const META = "scripts/qa/reports/rescue-pool-meta.json";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const OUT = "scripts/qa/reports/hwp-rescue.json";
const LEDGER = "scripts/qa/reports/hwp-rescue-ledger.json";
const SSOT = "scripts/qa/reports/unusable-problems.json";

interface Row {
  id: string;
  content: string;
  answer: string;
  figureUrls: string[];
  questionType: string | null;
  source: string;
  sourceFile: string | null;
  school: string | null;
  questionNumber: number | null;
  unitId: string | null;
  examId: string | null;
  externalId: string | null;
  score: number | null;
  problemType: string;
}

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const has = (name: string): boolean => process.argv.includes(name);

function readJsonl(file: string): Row[] {
  if (!existsSync(file))
    throw new Error(`없다: ${file} — export-rescue-pool.ts 를 먼저 돌려라`);
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Row);
}

const toDbRow = (r: Row): DbRow => ({
  id: r.id,
  externalId: r.externalId,
  examId: String(r.examId ?? ""),
  n: r.questionNumber ?? -1,
  problemType: r.problemType,
  score: r.score,
  content: r.content,
  answer: r.answer,
  figs: r.figureUrls?.length ?? 0,
});

const pct = (a: number, b: number): string =>
  b > 0 ? `${((a * 100) / b).toFixed(1)}%` : "—";

interface Detail {
  id: string;
  school: string | null;
  n: number | null;
  examId: string | null;
  source: string;
  verdictBefore: Verdict;
  cause: string;
  family: Family;
  rescue: Rescue;
  armVerdict: Record<Arm, Verdict | null>;
  slots: Record<Arm, number>;
  hwpChoices: number;
  hwpLen: number;
  evidence: OuterEvidence;
  pair: {
    dbKo: number;
    hwpKo: number;
    contain: number;
    sim: number;
    mismatched: boolean;
    undecidable: boolean;
  } | null;
  fake: Record<Arm, boolean>;
  alignGrade: string;
  /** 못 맞댄 사유 — 0으로 뭉개지 않는다. */
  missReason: string | null;
}

function main(): void {
  const meta = JSON.parse(readFileSync(META, "utf-8")) as Record<
    string,
    unknown
  >;
  const pool = readJsonl(POOL);
  const alignRows = readJsonl(ALIGN);

  console.log("# HWP 원본 회수 — 실측\n");
  console.log(
    `분모: **출제 가능 풀 ${pool.length}건** (스냅샷 ${String(meta["읽은시각"])})`,
  );

  /* ── 1. 지금 판정 — 전후에 **같은 자**를 댄다 ──────────────────────── */
  const judged = pool.map((r) => ({ r, j: judgeAnswerChoice(r) }));
  const fatal = judged.filter((x) => isFatal(x.j.verdict));
  const healthy = judged.filter((x) => x.j.verdict === "정상");
  const unclassified = judged.filter((x) => x.j.verdict === "미분류").length;
  console.log(
    `치명 **${fatal.length}건** · 정상 ${healthy.length}건 · 미분류 ${unclassified}건`,
  );

  if (existsSync(SSOT)) {
    const ssot = JSON.parse(readFileSync(SSOT, "utf-8")) as {
      pool: number;
      fatal: { id: string }[];
    };
    const a = new Set(ssot.fatal.map((f) => f.id));
    const b = new Set(fatal.map((x) => x.r.id));
    console.log(
      `SSOT 대조 — 앞 트랙 ${ssot.fatal.length}건(분모 ${ssot.pool}) vs 오늘 ${fatal.length}건(분모 ${pool.length}) · ` +
        `사라짐 ${[...a].filter((id) => !b.has(id)).length} · 새로 ${[...b].filter((id) => !a.has(id)).length}`,
    );
  }

  /* ── 2. 편 정렬 ─────────────────────────────────────────────────────── */
  const byExam = new Map<string, Map<number, DbRow>>();
  for (const r of alignRows) {
    if (r.questionNumber == null || !r.examId) continue;
    const eid = String(r.examId);
    if (!byExam.has(eid)) byExam.set(eid, new Map());
    byExam.get(eid)!.set(r.questionNumber, toDbRow(r));
  }

  const hwpByExam = new Map<string, HwpQ[]>();
  if (existsSync(HWP_DIR)) {
    for (const f of readdirSync(HWP_DIR).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(path.join(HWP_DIR, f), "utf-8")) as {
        questions?: HwpQ[];
      };
      hwpByExam.set(f.replace(/\.json$/, ""), doc.questions ?? []);
    }
  }

  const aligns = new Map<string, Align>();
  const gradeCount: Record<string, number> = { 확정: 0, 정황: 0, 근거없음: 0 };
  for (const [eid, qs] of hwpByExam) {
    const rows = byExam.get(eid);
    if (!rows || rows.size === 0) continue;
    const a = alignExam(qs, rows);
    aligns.set(eid, a);
    gradeCount[a.grade] = (gradeCount[a.grade] ?? 0) + 1;
  }
  console.log(
    `\n편 정렬 ${aligns.size}편 — 확정 ${gradeCount["확정"]} · 정황 ${gradeCount["정황"]} · 근거없음 ${gradeCount["근거없음"]}` +
      ` · 오프셋 보정 ${[...aligns.values()].filter((a) => a.offset !== 0).length}편`,
  );

  function hwpFor(r: Row): {
    q: HwpQ | null;
    grade: Align["grade"] | "편없음";
    miss: string | null;
  } {
    const eid = r.examId ? String(r.examId) : "";
    if (!eid) return { q: null, grade: "편없음", miss: "원본메타 없음" };
    const qs = hwpByExam.get(eid);
    const a = aligns.get(eid);
    // 「추출본이 없다」를 한 갈래로 뭉치면 **원본이 아예 없는 것**(RPM 교재 이관본)과
    // **원본은 있는데 못 뽑은 것**이 섞인다. 앞은 이 트랙이 닿을 수 없는 것이고
    // 뒤는 놓친 것이다 — 섞으면 「몇 건 놓쳤나」가 상한으로 안 묶인다.
    if (!qs)
      return {
        q: null,
        grade: "편없음",
        miss:
          r.source === "transformed"
            ? "RPM 교재 이관본 — 원본 HWP 자체가 없다"
            : "기출인데 추출본이 없다",
      };
    if (!a) return { q: null, grade: "편없음", miss: "DB 행이 없는 편" };
    if (a.grade === "근거없음")
      return { q: null, grade: "근거없음", miss: "정렬 근거 없음" };
    if (r.questionNumber == null)
      return { q: null, grade: a.grade, miss: "문항번호 없음" };
    const q = qs.find((x) => x.number + a.offset === r.questionNumber) ?? null;
    return {
      q,
      grade: q ? a.grade : "편없음",
      miss: q ? null : "편은 있으나 그 번호가 HWP 에 없음",
    };
  }

  function detailOf(r: Row, before: Verdict, cause: string): Detail {
    const { q, grade, miss } = hwpFor(r);
    const res = judgeRescue({
      content: r.content,
      answer: r.answer,
      figureUrls: r.figureUrls ?? [],
      score: r.score,
      hwp: q,
      alignGrade: grade,
    });
    const armVerdict = Object.fromEntries(
      ARMS.map((k) => [k, res.arms[k]?.verdict ?? null]),
    ) as Record<Arm, Verdict | null>;
    return {
      id: r.id,
      school: r.school,
      n: r.questionNumber,
      examId: r.examId,
      source: r.source,
      verdictBefore: before,
      cause,
      family: familyOf(cause),
      rescue: res.rescue,
      armVerdict,
      slots: res.slots,
      hwpChoices: res.hwpChoices,
      hwpLen: res.hwpLen,
      evidence: res.evidence,
      pair: res.pair,
      fake: res.fake,
      alignGrade: grade,
      missReason:
        res.rescue === "대응실패" ? (miss ?? "판정 불가(미분류)") : null,
    };
  }

  /* ── 3. 치명 — 회복 판정 ────────────────────────────────────────────── */
  const details = fatal.map(({ r, j }) => detailOf(r, j.verdict, j.cause));

  const RESCUE_ORDER: Rescue[] = [
    "완전회복",
    "치명탈출",
    "부분",
    "HWP도못살림",
    "문항불일치",
    "보기가짜",
    "대응실패",
  ];
  const countBy = <K extends string>(
    xs: Detail[],
    key: (d: Detail) => K,
  ): Map<K, number> => {
    const m = new Map<K, number>();
    for (const d of xs) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
    return m;
  };

  const byRescue = countBy(details, (d) => d.rescue);
  console.log("\n### 회복 판정 — 치명 전량\n");
  console.log("| 갈래 | 건수 | 비율 |");
  console.log("| --- | ---: | ---: |");
  for (const k of RESCUE_ORDER)
    console.log(
      `| ${k} | ${byRescue.get(k) ?? 0} | ${pct(byRescue.get(k) ?? 0, details.length)} |`,
    );
  console.log(`| **합계** | **${details.length}** | |`);

  /* 팔마다 — 「무엇을 해야 사는가」 */
  console.log(
    "\n### 팔마다 «정상» 이 되는 건수 (분모 = 치명 " + details.length + ")\n",
  );
  const meansOf: Record<Arm, string> = {
    DB: "지금 그대로 — 분모라 0이어야 한다",
    HWP: "재추출만 한다 (지금 파서 그대로)",
  };
  const armNormal: Record<Arm, number> = {
    DB: 0,
    HWP: 0,
  };
  console.log("");
  const armFake: Record<Arm, number> = {
    DB: 0,
    HWP: 0,
  };
  for (const k of ARMS) {
    const normal = details.filter((d) => d.armVerdict[k] === "정상");
    armNormal[k] = normal.length;
    armFake[k] = normal.filter((d) => d.fake[k]).length;
  }
  console.log("| 팔 | 정상 | 비율 | 🚩 그중 보기가 가짜 | 뜻 |");
  console.log("| --- | ---: | ---: | ---: | --- |");
  for (const k of ARMS)
    console.log(
      `| ${k} | ${armNormal[k]} | ${pct(armNormal[k], details.length)} | ${armFake[k]} | ${meansOf[k]} |`,
    );
  console.log(
    "\n> 🚩 «보기가 가짜» 는 보기 칸이 다섯이라 판정이 `정상` 인데 " +
      "**그 칸이 보기가 아닌** 것이다 (발문 토막이 칸에 들어앉았다). " +
      "성한 문항의 HWP·HWP+R2 본문 3,372건에서 **0건**인 모양이라 문턱 없이 가른다. " +
      "지금 이 표에서도 **0건**이다 — 잡히라고 만든 것이 아니라, 잡히면 회복으로 " +
      "세지 않으려고 둔 가드다.",
  );

  // ⚠️ 팔의 판정만 보면 안 된다 — **짝이 아닌 행도 HWP 팔이 «정상»** 이다
  //    (다른 문제의 보기 다섯이 서니까). 실측 3건이 그래서 여기 섞여 18 로 나왔다.
  //    회복으로 세는 것은 가드를 통과한 «완전회복» 뿐이다.
  const onlyHwp = details.filter((d) => d.rescue === "완전회복").length;
  console.log(
    `\n**재추출이 있어야만 사는 것 ${onlyHwp}건** — R2 는 이미 제품에 있다(D-58), 즉 DB 팔이 곧 현행이다`,
  );

  /* 부류별 */
  const FAMILIES: Family[] = ["본문", "그림", "정답데이터", "지면", "기타"];
  console.log("\n### 부류 × 회복 (브리프 §1)\n");
  console.log(`| 부류 | 분모 | ${RESCUE_ORDER.join(" | ")} |`);
  console.log(`| --- | ---: | ${RESCUE_ORDER.map(() => "---:").join(" | ")} |`);
  for (const fam of FAMILIES) {
    const xs = details.filter((d) => d.family === fam);
    if (xs.length === 0) continue;
    const c = countBy(xs, (d) => d.rescue);
    console.log(
      `| ${fam} | ${xs.length} | ${RESCUE_ORDER.map((k) => c.get(k) ?? 0).join(" | ")} |`,
    );
  }

  console.log("\n### 원인 × 회복\n");
  const causes = [...new Set(details.map((d) => d.cause))].sort();
  console.log(`| 원인 | 분모 | ${RESCUE_ORDER.join(" | ")} |`);
  console.log(`| --- | ---: | ${RESCUE_ORDER.map(() => "---:").join(" | ")} |`);
  for (const c of causes) {
    const xs = details.filter((d) => d.cause === c);
    const m = countBy(xs, (d) => d.rescue);
    console.log(
      `| ${c} | ${xs.length} | ${RESCUE_ORDER.map((k) => m.get(k) ?? 0).join(" | ")} |`,
    );
  }

  /* 대응 실패 — 사유를 갈라 찍는다 */
  const miss = details.filter((d) => d.rescue === "대응실패");
  const missBy = new Map<string, number>();
  for (const d of miss)
    missBy.set(d.missReason ?? "-", (missBy.get(d.missReason ?? "-") ?? 0) + 1);
  console.log("\n### 대응 실패의 사유 (0으로 뭉개지 않는다)\n");
  console.log("| 사유 | 건수 |");
  console.log("| --- | ---: |");
  for (const [k, v] of [...missBy].sort((a, b) => b[1] - a[1]))
    console.log(`| ${k} | ${v} |`);
  console.log(`| **합계** | **${miss.length}** |`);

  /* 🚩 짝이 아닌 것 · 보기가 가짜인 것 — **전량 나열한다.** 회복으로 세지 않은 근거다. */
  const flagged = details.filter(
    (d) => d.rescue === "문항불일치" || d.rescue === "보기가짜",
  );
  if (flagged.length > 0) {
    console.log("\n### 🚩 회복으로 세지 **않은** 것 — 전량\n");
    console.log(
      "| 문항 | 왜 | 포함도 | (Dice) | DB 한글 | HWP 한글 | 정답일치 | 배점일치 |",
    );
    console.log("| --- | --- | ---: | ---: | ---: | ---: | :-: | :-: |");
    for (const d of flagged)
      console.log(
        `| ${d.school ?? "(학교 없음)"} ${d.n ?? ""} \`${d.id.slice(0, 8)}\` | ${d.rescue} | ` +
          `${d.pair ? d.pair.contain.toFixed(3) : "—"} | ${d.pair ? d.pair.sim.toFixed(3) : "—"} | ${d.pair?.dbKo ?? "—"} | ${d.pair?.hwpKo ?? "—"} | ` +
          `${d.evidence.정답일치 ? "✅" : "—"} | ${d.evidence.배점일치 ? "✅" : "—"} |`,
      );
  }

  /* 완전회복의 본문 밖 근거 */
  const 완전 = details.filter((d) => d.rescue === "완전회복");
  const ev = {
    정답일치: 완전.filter((d) => d.evidence.정답일치).length,
    정답불일치: 완전.filter((d) => d.evidence.정답불일치).length,
    정답못견줌: 완전.filter((d) => d.evidence.정답못견줌).length,
    배점일치: 완전.filter((d) => d.evidence.배점일치).length,
    근거없음: 완전.filter((d) => !d.evidence.정답일치 && !d.evidence.배점일치)
      .length,
  };
  console.log(
    `\n완전회복 ${완전.length}건의 **본문 밖 근거** — HWP 미주 정답 일치 ${ev.정답일치} · ` +
      `**불일치 ${ev.정답불일치}** · 못 견줌 ${ev.정답못견줌} · 배점 일치 ${ev.배점일치} · 근거 없음 ${ev.근거없음}`,
  );

  /* ── 3.5 정답 검산 — **HWP 미주가 정답을 준다** (브리프 §0) ─────────── */
  //
  // 브리프는 「§4.5 정답 표기가 갈린다 10건은 원본 정답면을 사람이 열 필요가 없을 수
  // 있다」고 적었다. 그 추측을 여기서 잰다. 열쇠는 **본문 밖**이다 — HWP 미주는
  // 시험지 본문이 아니라 파일의 다른 자리라, 「값이냐 번호냐」를 본문 안에서 못 가르는
  // 문항을 갈라 준다.
  const rowById0 = new Map(pool.map((r) => [r.id, r]));
  const 모호 = details.filter((d) => d.verdictBefore === "정답표기가모호");
  let 미주로풀림 = 0;
  const 모호표: string[] = [];
  for (const d of 모호) {
    const r = rowById0.get(d.id)!;
    const { q } = hwpFor(r);
    const raw = (q?.answer ?? "").replace(/^\s*정답\s*[:：]?\s*/, "").trim();
    const 원문자 = raw.length > 0 && /^[①-⑮❶-❿➀-➉➊-➓⓵-⓾]/.test(raw);
    if (원문자) 미주로풀림 += 1;
    모호표.push(
      `| ${d.school ?? "(학교 없음)"} ${d.n ?? ""} | \`${(r.answer ?? "").slice(0, 20)}\` | ${q ? `\`${raw.slice(0, 24)}\`` : "— (편 없음)"} | ${원문자 ? "✅ 번호로 확정" : "❌"} |`,
    );
  }
  console.log("\n### 정답 표기가 갈리는 문항 — **HWP 미주가 풀어 주는가**\n");
  console.log(
    `분모 ${모호.length}건 · **미주가 원문자로 답을 준 것 ${미주로풀림}건**\n`,
  );
  console.log("| 문항 | DB 정답 | HWP 미주 | |");
  console.log("| --- | --- | --- | :-: |");
  for (const line of 모호표) console.log(line);

  // 치명 전량에서 미주 정답이 DB 와 어긋나는 것 — 회복해도 답이 갈린다.
  const 견줌 = details.filter((d) => !d.evidence.정답못견줌);
  console.log(
    `\n치명 중 HWP 미주와 DB 정답을 **견줄 수 있었던 것 ${견줌.length}건** — ` +
      `일치 ${견줌.filter((d) => d.evidence.정답일치).length} · **불일치 ${견줌.filter((d) => d.evidence.정답불일치).length}**`,
  );

  /* ── 4. 반증 — 반대쪽 모집단 **전량** ───────────────────────────────── */
  const 반대쪽 = healthy.filter((x) => {
    const eid = x.r.examId ? String(x.r.examId) : "";
    return hwpByExam.has(eid) && aligns.has(eid);
  });
  const harmDetail: Detail[] = [];
  const harmByArm: Record<Arm, number> = {
    DB: 0,
    HWP: 0,
  };
  let matchedCounter = 0;
  for (const { r } of 반대쪽) {
    const d = detailOf(r, "정상", "-");
    if (d.rescue !== "대응실패") matchedCounter += 1;
    for (const k of ARMS) {
      const v = d.armVerdict[k];
      if (v && isFatal(v)) harmByArm[k] += 1;
    }
    if (d.armVerdict.HWP && isFatal(d.armVerdict.HWP)) {
      harmDetail.push(d);
    }
  }
  console.log("\n### 반증 — **성한 문항에 같은 교체를 대면**\n");
  console.log(
    `분모: 정상 ${healthy.length}건 중 **추출한 ${hwpByExam.size}편에 속한 ${반대쪽.length}건 전량** ` +
      `(그중 HWP 짝을 찾은 것 ${matchedCounter})\n`,
  );
  const harmMismatched = harmDetail.filter((d) => d.pair?.mismatched).length;
  console.log(
    `그중 **짝이 아닌 것(다른 문제)으로 표시된 행 ${harmMismatched}건** — ` +
      `개악 집계에서 빼지는 않았고, 짝 확인이 반대쪽에서도 도는지 보이려고 찍는다.
`,
  );
  console.log("| 팔 | 🔴 개악 (정상 → 치명) | 비율 |");
  console.log("| --- | ---: | ---: |");
  for (const k of ARMS)
    console.log(
      `| ${k} | ${harmByArm[k]} | ${pct(harmByArm[k], 반대쪽.length)} |`,
    );
  console.log(
    `\n⚠️ 이 분모는 «정상 ${healthy.length}건 전량»이 아니다 — HWP 추출본이 있는 편에 한한다. ` +
      `추출본이 없는 편은 교체 규칙이 **애초에 발동하지 않는다.**`,
  );

  /* ── 5. 표본 ───────────────────────────────────────────────────────── */
  const nSamples = Number(arg("--samples") ?? 0);
  if (nSamples > 0) {
    const want = arg("--rescue");
    const wantFam = arg("--family");
    const wantCause = arg("--cause");
    const pickFrom = has("--harm") ? harmDetail : details;
    const rowById = new Map(pool.map((r) => [r.id, r]));
    const shown = pickFrom
      .filter((d) => (want ? d.rescue === want : true))
      .filter((d) => (wantFam ? d.family === wantFam : true))
      .filter((d) => (wantCause ? d.cause === wantCause : true))
      .filter((d) => {
        const want = arg("--id");
        return want ? d.id.startsWith(want) : true;
      })
      .slice(Number(arg("--skip") ?? 0), Number(arg("--skip") ?? 0) + nSamples);
    for (const d of shown) {
      const r = rowById.get(d.id)!;
      const { q } = hwpFor(r);
      console.log("\n" + "=".repeat(78));
      console.log(
        `${d.school ?? "(학교 없음)"} ${d.n}번 [${d.id.slice(0, 8)}] ${d.verdictBefore} / ${d.cause}` +
          ` → **${d.rescue}** · 정렬 ${d.alignGrade}`,
      );
      console.log(
        `팔: ${ARMS.map((k) => `${k}=${d.armVerdict[k] ?? "—"}(${d.slots[k]}칸)${d.fake[k] ? "🚩가짜" : ""}`).join("  ")}`,
      );
      console.log(
        `짝: ${d.pair ? `포함도 ${d.pair.contain.toFixed(3)} (Dice ${d.pair.sim.toFixed(3)}) · DB 한글 ${d.pair.dbKo} · HWP 한글 ${d.pair.hwpKo}${d.pair.mismatched ? " 🚩다른 문항" : d.pair.undecidable ? " (한쪽이 짧아 견줄 수 없음)" : ""}` : "—"}`,
      );
      console.log(
        `정답(DB): ${JSON.stringify(r.answer)} · HWP 미주: ${JSON.stringify(q?.answer ?? null)} · 근거 ${JSON.stringify(d.evidence)}`,
      );
      console.log(`── DB 본문 ──\n${r.content.slice(0, 600)}`);
      if (q) {
        console.log(`── HWP 발문 ──\n${(q.stem ?? "").slice(0, 400)}`);
        console.log(`── HWP 보기 ${q.choices?.length ?? 0}칸 ──`);
        (q.choices ?? []).forEach((c, i) =>
          console.log(`   ${i + 1}. ${String(c).slice(0, 200)}`),
        );
      }
    }
  }

  if (has("--list")) {
    console.log("\n### 전량 목록\n");
    for (const d of details)
      console.log(
        `${d.rescue}\t${d.family}\t${d.cause}\t${d.id}\t${d.school ?? ""}\t${d.n ?? ""}`,
      );
  }

  /* ── 6. 산출물 ─────────────────────────────────────────────────────── */
  mkdirSync(path.dirname(OUT), { recursive: true });
  const summary = {
    스냅샷: meta,
    분모: {
      풀: pool.length,
      치명: details.length,
      정상: healthy.length,
      미분류: unclassified,
    },
    추출편: hwpByExam.size,
    정렬: gradeCount,
    회복: Object.fromEntries(
      RESCUE_ORDER.map((k) => [k, byRescue.get(k) ?? 0]),
    ),
    팔별정상: armNormal,
    팔별보기가짜: armFake,
    원본이있어야사는것: onlyHwp,
    완전회복근거: ev,
    대응실패사유: Object.fromEntries(missBy),
    반증: { 분모: 반대쪽.length, 짝찾음: matchedCounter, 개악: harmByArm },
  };
  writeFileSync(
    OUT,
    JSON.stringify({ ...summary, details, harmDetail }, null, 1),
    "utf-8",
  );
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        생성: new Date().toISOString(),
        ...summary,
        rows: details.map((d) => ({
          id: d.id,
          school: d.school,
          n: d.n,
          examId: d.examId,
          verdictBefore: d.verdictBefore,
          cause: d.cause,
          family: d.family,
          rescue: d.rescue,
          armVerdict: d.armVerdict,
          evidence: d.evidence,
          missReason: d.missReason,
        })),
        harm: harmDetail.map((d) => ({
          id: d.id,
          school: d.school,
          n: d.n,
          armVerdict: d.armVerdict,
        })),
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(`\n→ ${OUT} · ${LEDGER}`);
}

main();
