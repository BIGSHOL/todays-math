/**
 * DB 결함 두 종류를 **인계용 목록**으로 낸다 (트랙 G → 코디네이터).
 *
 *   npx tsx scripts/classify/export-defect-handover.ts
 *
 * 트랙 G 는 고치지 않는다. 목록과 근거까지가 내 몫이다.
 *
 *   결함 1) 시험지 학년 ≠ 라벨 학년 — 중2·중3 문항이 고등 단원에 붙어 있다.
 *   결함 2) 본문 ≠ 라벨 — 본문 교체 때 번호 정렬이 깨진 편에서 라벨만 옛것으로 남았다.
 *
 * 둘 다 **분류 정확도 문제가 아니라 이미 DB 에 들어가 있는 행이 틀린 것**이고,
 * 조용히 틀린다 — 중3 진도에는 그 문항이 안 나오고, 고1 진도에는 중학 문항이 나온다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ExamMeta, OUT_DIR, TRACK_D_REPORTS, UNITS_FILE, Unit, gradeKeyOf } from "./paths";
import { mapUnitHint } from "../../src/lib/import/mapUnit";

const HANDOVER_JSON = `${OUT_DIR}/defect-handover.json`;
const HANDOVER_MD = "docs/planning/tracks/reports/track-g-defects-handover.md";

type LabelRow = {
  problemId: string;
  externalId: string;
  examId: string | null;
  n: number | null;
  unitId: string;
};

type GradeDefect = {
  problemId: string;
  externalId: string;
  examId: string;
  questionNumber: number | null;
  시험지학년: string;
  현재unitId: string;
  현재단원: string;
  근거: Record<string, unknown>;
};

type ContentDefect = {
  problemId: string | null;
  externalId: string;
  examId: string;
  questionNumber: number;
  현재unitId: string | null;
  현재단원: string;
  본문이가리키는단원: string;
  같은중단원: boolean;
  근거: Record<string, unknown>;
};

type AuditRow = {
  externalId: string;
  examId: string;
  n: number;
  topic: unknown;
  현재라벨: string;
  본문이가리키는단원: string;
  본문유사도: number;
  같은중단원: boolean;
};

/** 원본 파일명 — 시험지 학년 판정의 1차 근거다(예: `[성광중][2][25-1-기말]`). */
const fileNameOf = (meta: ExamMeta & { pdf?: string; hwp?: string }): string => {
  const path = meta.pdf ?? meta.hwp ?? "";
  return path.split(/[\\/]/).pop() ?? "";
};

const countBy = <T,>(items: T[], key: (item: T) => string): [string, number][] => {
  const table = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    table.set(k, (table.get(k) ?? 0) + 1);
  }
  return [...table.entries()].sort((a, b) => b[1] - a[1]);
};

function main() {
  const units: Unit[] = JSON.parse(readFileSync(UNITS_FILE, "utf8"));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const metas: (ExamMeta & { pdf?: string })[] = [
    ...JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs.json`, "utf8")).pairs,
    ...JSON.parse(readFileSync(`${TRACK_D_REPORTS}/final-pairs-extra.json`, "utf8")).pairs,
  ];
  const metaById = new Map(metas.map((m) => [String(m.examId), m]));
  const rows: LabelRow[] = readFileSync(`${OUT_DIR}/db-labels.jsonl`, "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const byExternalId = new Map(rows.map((r) => [r.externalId, r]));

  // ── 결함 1: 시험지 학년 ≠ 라벨 학년 ──────────────────────────────────────
  const gradeDefects: GradeDefect[] = [];
  for (const row of rows) {
    const meta = metaById.get(String(row.examId));
    const unit = unitById.get(row.unitId);
    if (!meta || !unit) continue;
    const examGrade = gradeKeyOf(meta);
    if (!examGrade || examGrade === unit.grade) continue;
    gradeDefects.push({
      problemId: row.problemId,
      externalId: row.externalId,
      examId: String(row.examId),
      questionNumber: row.n,
      시험지학년: examGrade,
      현재unitId: row.unitId,
      현재단원: `${unit.grade} / ${unit.chapter} / ${unit.section}`,
      근거: {
        원본파일명: fileNameOf(meta),
        학교: meta.school,
        level: meta.level,
        grade: meta.grade,
        subject: meta.subject,
        year: meta.year,
        semester: meta.semester,
        round: meta.round,
        판정경로: "final-pairs 메타(level·grade·subject) → paths.ts gradeKeyOf()",
      },
    });
  }

  // ── 결함 2: 본문 ≠ 라벨 (같은 학년 안) ───────────────────────────────────
  const audit = JSON.parse(readFileSync(`${OUT_DIR}/label-content-mismatch.json`, "utf8"));
  const contentDefects: ContentDefect[] = (audit.목록 as AuditRow[])
    .filter((s) => s.현재라벨.split(" / ")[0] === s.본문이가리키는단원.split(" / ")[0])
    .map((s) => {
      const row = byExternalId.get(s.externalId);
      return {
        problemId: row?.problemId ?? null,
        externalId: s.externalId,
        examId: s.examId,
        questionNumber: s.n,
        현재unitId: row?.unitId ?? null,
        현재단원: s.현재라벨,
        본문이가리키는단원: s.본문이가리키는단원,
        같은중단원: s.같은중단원,
        근거: {
          재추출본topic: s.topic,
          DB본문_재추출본문_유사도: s.본문유사도,
          판정경로:
            "DB content 가 그 번호의 재추출 본문과 일치(≥0.6) → 그 번호의 topic 을 mapUnitHint 로 매핑 → 현재 라벨과 다름",
        },
      };
    });

  // ── 결함 1 의 원인 추적 — 어디로 몰렸고, 무엇 때문인가 ────────────────
  const targetTally = countBy(gradeDefects, (d) => d.현재단원);
  const [topTarget, topTargetCount] = targetTally[0] ?? ["(없음)", 0];
  const questionCache = new Map<string, Map<string, { topic?: unknown }>>();
  const questionsOf = (examId: string) => {
    if (!questionCache.has(examId)) {
      const file = `${TRACK_D_REPORTS}/hwp-latex/${examId}.json`;
      const list = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).questions ?? [] : [];
      questionCache.set(examId, new Map(list.map((q: { number: unknown }) => [String(q.number), q])));
    }
    return questionCache.get(examId)!;
  };
  const topicTally = countBy(
    gradeDefects.filter((d) => d.현재단원 === topTarget),
    (d) => String(questionsOf(d.examId).get(String(d.questionNumber))?.topic ?? "(없음)"),
  );
  const describe = (result: ReturnType<typeof mapUnitHint>): string => {
    if (result.status !== "mapped") return "미분류";
    const u = unitById.get(result.unitId);
    return u ? `${u.grade} / ${u.section}` : result.unitId;
  };
  const reproduction = topicTally.slice(0, 3).map(([topic]) => {
    const sample = gradeDefects.find(
      (d) => d.현재단원 === topTarget &&
        String(questionsOf(d.examId).get(String(d.questionNumber))?.topic ?? "") === topic,
    );
    return {
      topic,
      withGrade: describe(mapUnitHint(topic, units, sample?.시험지학년)),
      without: describe(mapUnitHint(topic, units, undefined)),
    };
  });

  const gradeExams = new Set(gradeDefects.map((d) => d.examId));
  const contentExams = new Set(contentDefects.map((d) => d.examId));

  writeFileSync(HANDOVER_JSON, JSON.stringify({
    생성: "scripts/classify/export-defect-handover.ts",
    결함1_학년불일치: { 건수: gradeDefects.length, 편수: gradeExams.size },
    결함2_본문라벨불일치: { 건수: contentDefects.length, 편수: contentExams.size },
    결함1: gradeDefects,
    결함2: contentDefects,
  }, null, 1), "utf8");

  // ── 인계 문서 ────────────────────────────────────────────────────────────
  const md: string[] = [];
  md.push("# 트랙 G 인계 — DB 행 결함 목록 (2026-08-16)");
  md.push("");
  md.push("> 트랙 G 가 분류 정확도를 실측하다가 찾은 것이다. **분류 정확도 문제가 아니라");
  md.push("> 이미 DB 에 들어가 있는 행이 틀린 것**이라 트랙 G 가 고칠 수 없다(내 소유 컬럼이 아니다).");
  md.push("> 코디네이터가 받아 임자를 정한다.");
  md.push(">");
  md.push("> 전체 목록(problemId 포함): `scripts/classify/reports/defect-handover.json`");
  md.push("> 재생성: `npx tsx scripts/classify/export-defect-handover.ts`");
  md.push("");
  md.push("두 결함 모두 **조용히 틀린다.** 원장님이 중3 진도를 넣으면 그 문항이 안 나오고,");
  md.push("고1 공통수학2 진도에서는 중학 문항이 튀어나온다. 화면 어디에도 경고가 뜨지 않는다.");
  md.push("");
  md.push("---");
  md.push("");
  md.push(`## 결함 1 — 시험지 학년 ≠ 라벨 학년 (**${gradeDefects.length}건 / ${gradeExams.size}편**)`);
  md.push("");
  md.push("| 유형 | 건수 |");
  md.push("|---|---|");
  for (const [k, v] of countBy(gradeDefects, (d) => `${d.시험지학년} 시험지 → ${d.현재단원.split(" / ")[0]} 단원`)) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push("");
  md.push("**근거**: 시험지 학년은 `final-pairs.json` 메타(`level`·`grade`·`subject`)를");
  md.push("`scripts/classify/paths.ts` 의 `gradeKeyOf()` 로 옮긴 값이다. 이 판정 자체는 검증돼 있다 —");
  md.push("이미 분류된 35,666행 중 **99.54% 가 라벨의 학년과 일치**했고, 어긋난 것이 아래 목록이다.");
  md.push("원본 파일명이 학년을 그대로 적고 있어 눈으로도 확인된다.");
  md.push("");
  md.push("편별 상위 10:");
  md.push("");
  md.push("| examId | 건수 | 원본 파일명 | 시험지 학년 | 현재 붙은 학년 |");
  md.push("|---|---|---|---|---|");
  for (const [examId, count] of countBy(gradeDefects, (d) => d.examId).slice(0, 10)) {
    const one = gradeDefects.find((d) => d.examId === examId)!;
    md.push(`| ${examId} | ${count} | \`${one.근거.원본파일명}\` | ${one.시험지학년} | ${one.현재단원.split(" / ")[0]} |`);
  }
  md.push("");
  md.push("표본 3건 (전체는 JSON):");
  md.push("");
  md.push("| problemId | externalId | 시험지 학년 | 현재 unitId | 현재 단원 |");
  md.push("|---|---|---|---|---|");
  for (const d of gradeDefects.slice(0, 3)) {
    md.push(`| \`${d.problemId}\` | ${d.externalId} | ${d.시험지학년} | \`${d.현재unitId}\` | ${d.현재단원} |`);
  }
  md.push("");
  md.push("### 결함 1 의 원인 — 한 곳으로 몰렸다");
  md.push("");
  md.push(`43편에 흩어져 있지만 **${topTargetCount}건(${Math.round((topTargetCount / gradeDefects.length) * 100)}%)이 같은 단원 하나**로 갔다 — \`${topTarget}\`.`);
  md.push("독립된 실수 43개가 아니라 **원인이 하나**다.");
  md.push("");
  md.push("그 문항들의 원본 `topic`:");
  md.push("");
  md.push("| topic | 건수 |");
  md.push("|---|---|");
  for (const [topic, count] of topicTally.slice(0, 6)) md.push(`| ${topic} | ${count} |`);
  md.push("");
  md.push("`mapUnitHint` 를 같은 topic 으로 다시 돌려 보면 원인이 그대로 나온다:");
  md.push("");
  md.push("| topic | 학년 힌트 있을 때 | 학년 힌트 없을 때 |");
  md.push("|---|---|---|");
  for (const row of reproduction) md.push(`| ${row.topic} | ${row.withGrade} | **${row.without}** |`);
  md.push("");
  md.push("**학년이 안 잡히면 후보 pool 이 초1~고3 전체 735개가 되고, 공통수학2 의 소단원 이름이");
  md.push("하필 그냥 `함수` 라 `일차함수와 그래프`·`이차함수의 활용` 이 부분문자열로 걸린다.**");
  md.push("`mapUnit.ts` 는 이 위험을 주석으로 이미 적어 뒀지만(\"학년을 모르면 pool 이 초1~고3");
  md.push("전체라 중등 '좌표와 그래프' 가 초2 '표와 그래프' 에 붙는다\"), 그 가드는 **유사도 단계에만**");
  md.push("걸려 있고 부분문자열 단계에는 걸려 있지 않다.");
  md.push("");
  md.push("> 트랙 G 는 `mapUnit.ts` 를 고치지 않았다(공용 분류 로직, 원장님 확인 후 착수 영역).");
  md.push("> **제안**: 부분문자열 단계에도 학년 해석 여부 가드를 걸거나, 학년이 없으면 아예 미분류로");
  md.push("> 남긴다. 다만 이 판정을 고치면 기존 적재분 전체가 영향을 받으므로 원장님 확인이 필요하다.");
  md.push("");
  md.push("---");
  md.push("");
  md.push(`## 결함 2 — 본문 ≠ 라벨 (같은 학년 안, **${contentDefects.length}건 / ${contentExams.size}편**)`);
  md.push("");
  md.push("트랙 D 가 문항 번호를 열쇠로 `content` 를 재추출본으로 교체했는데, **번호 정렬이 어긋난");
  md.push("편에서는 본문만 바뀌고 라벨은 옛 본문 기준으로 남았다.**");
  md.push("");
  md.push("| examId | 건수 |");
  md.push("|---|---|");
  for (const [examId, count] of countBy(contentDefects, (d) => d.examId).slice(0, 10)) {
    md.push(`| ${examId} | ${count} |`);
  }
  md.push("");
  md.push("**근거**: DB `content` 가 그 번호의 재추출 본문과 일치하는데(한글 bigram Dice ≥ 0.6),");
  md.push("그 번호의 `topic` 을 `mapUnitHint` 로 붙인 단원이 현재 라벨과 다르다.");
  md.push("즉 **본문은 그 번호가 맞고 라벨이 옛 본문 것**이다.");
  md.push("");
  md.push("표본 3건 (전체는 JSON):");
  md.push("");
  md.push("| problemId | externalId | 재추출 topic | 현재 단원 | 본문이 가리키는 단원 |");
  md.push("|---|---|---|---|---|");
  for (const d of contentDefects.slice(0, 3)) {
    md.push(`| \`${d.problemId}\` | ${d.externalId} | ${d.근거.재추출본topic} | ${d.현재단원} | ${d.본문이가리키는단원} |`);
  }
  md.push("");
  md.push("---");
  md.push("");
  md.push("## 고칠 때 주의할 것");
  md.push("");
  md.push("1. **결함 2 는 `unitId` 를 고칠지 `content` 를 되돌릴지가 갈린다.** 본문이 그 번호의 것이");
  md.push("   맞으므로 `unitId` 를 본문에 맞추는 쪽이 자연스럽지만, 그 편 전체의 번호 정렬이");
  md.push("   깨져 있으므로 **한 행씩이 아니라 편 단위로** 판단해야 한다.");
  md.push("2. **결함 1 은 학년부터 다시 잡아야 한다.** 중2 시험지 문항에 고등 공통수학2 단원이");
  md.push("   붙어 있으므로, 그 문항의 `topic` 으로 **중2 트리에서** 다시 매핑한다.");
  md.push("3. **두 결함 모두 트랙 G 가 학습셋에서 제외했다.** 고치면 학습셋이 그만큼 늘어난다 —");
  md.push("   실제로 오염 행을 걷어냈더니 공통수학2 판정이 0건 → 180건으로 열렸다.");
  md.push("4. 고치기 전 `problemId` 기준으로 백업을 남길 것.");
  md.push("");
  writeFileSync(HANDOVER_MD, md.join("\n"), "utf8");

  console.log(`결함1 학년불일치 ${gradeDefects.length}건 / ${gradeExams.size}편`);
  console.log(`결함2 본문라벨불일치 ${contentDefects.length}건 / ${contentExams.size}편`);
  console.log(`→ ${HANDOVER_MD}`);
  console.log(`→ ${HANDOVER_JSON}`);
}

main();
