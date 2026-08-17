/**
 * 단원 오분류 감사 3축을 합쳐 **교정 대상 확정 목록**을 만든다. **읽기 전용 · DB 미수정.**
 *
 *   npx tsx scripts/classify/consolidate-unit-audit.ts
 *
 * 세 축은 서로 다른 것을 본다. 합쳐야 교정이 가능하다.
 *
 * | 축 | 근거 | 강한 것 | 약한 것 |
 * |---|---|---|---|
 * | 메타 (`audit-metadata-unit`) | 학교·과목·원본 경로 | **목적지 학년을 정확히 안다** | 같은 학년 안은 못 본다 |
 * | 본문 (`audit-content-unit`) | content 어휘 | **배정이 틀렸음을 넓게 잡는다** | 목적지는 최다 몫 추정이라 틀릴 수 있다 |
 * | 초등 (`audit-elementary-unit`) | 초등에 없는 표기·개념 | 메타 없는 변형본까지 본다 | 초등 배정분만 |
 *
 * ⚠️ **목적지는 메타 축을 따른다.** 부모 세션이 실측한 근거:
 * `2683-14`(두 이차함수가 직선에 동시 접함)와 `4496-21`(실수 k 에 무관하게 x축 접함)을
 * 본문 축은 「중3」이라 했지만 원본이 경화여고 수상 · 제일고 공수1 이라 **공통수학1** 이 맞다.
 * 본문 축 스스로도 한계 §5-5 에 「목적지는 최다 몫으로 찍은 추정」이라 적어 두었다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const R = "scripts/classify/reports";
const OUT = `${R}/unit-audit-consolidated.json`;

/** 세 축 보고서에서 실제로 읽는 필드만 최소로 적는다(나머지는 무시). */
type MetaRow = {
  externalId?: string;
  id?: string;
  기대학년?: string;
  근거?: string;
};
type ContentRow = {
  externalId?: string;
  problemId?: string;
  id?: string;
  판정?: string;
  신호?: string;
};
type ElemRow = { id: string; 근거?: string[] };

type Finding = {
  problemId: string;
  externalId: string | null;
  source: string;
  현재단원: string;
  축: string[];
  기대학년: string | null;
  목적지근거: string | null;
  확신도: "상" | "중" | "하";
  본문: string;
};

/** 확신도 — 축이 겹칠수록, 목적지를 아는 축이 있을수록 높다. */
function confidenceOf(
  축: string[],
  기대학년: string | null,
): Finding["확신도"] {
  if (축.length >= 2 && 기대학년) return "상";
  if (기대학년) return "중";
  return "하";
}

async function main() {
  const read = (name: string): { 목록?: unknown[] } =>
    JSON.parse(readFileSync(`${R}/${name}`, "utf8")) as { 목록?: unknown[] };
  const meta = read("metadata-unit-mismatch.json");
  const content = read("content-unit-mismatch.json");
  const elem = read("elementary-unit-mismatch.json");

  const metaRows = (meta.목록 ?? []) as MetaRow[];
  const elemRows = (elem.목록 ?? []) as ElemRow[];
  // 본문 축은 「오분류」만 취한다 — 「의심」 563건은 근거가 한쪽뿐이라 교정 대상이 아니다.
  const contentRows = ((content.목록 ?? []) as ContentRow[]).filter(
    (r) => r.판정 === "오분류",
  );

  console.log(
    `축별 오분류 — 메타 ${metaRows.length} · 본문 ${contentRows.length} · 초등 ${elemRows.length}`,
  );

  /** externalId 를 problemId 로 정규화한다(축마다 키가 다르다). */
  const idOf = new Map<string, string>();
  const externalIds = [
    ...metaRows.map((r) => r.externalId),
    ...contentRows.map((r) => r.externalId),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (externalIds.length) {
    const rows = await prisma.problem.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    for (const r of rows) idOf.set(r.externalId!, r.id);
  }

  const merged = new Map<string, Finding>();

  function add(
    problemId: string,
    축: string,
    기대학년: string | null,
    근거: string | null,
  ) {
    const cur = merged.get(problemId);
    if (cur) {
      if (!cur.축.includes(축)) cur.축.push(축);
      // 목적지는 **메타 축이 이긴다**(위 주석 참조). 메타가 없을 때만 다른 축의 값을 쓴다.
      if (축 === "메타" && 기대학년) {
        cur.기대학년 = 기대학년;
        cur.목적지근거 = 근거;
      } else if (!cur.기대학년 && 기대학년) {
        cur.기대학년 = 기대학년;
        cur.목적지근거 = 근거;
      }
      return;
    }
    merged.set(problemId, {
      problemId,
      externalId: null,
      source: "",
      현재단원: "",
      축: [축],
      기대학년: 기대학년 ?? null,
      목적지근거: 근거 ?? null,
      확신도: "하",
      본문: "",
    });
  }

  for (const r of metaRows) {
    const pid = r.externalId ? idOf.get(r.externalId) : r.id;
    if (pid) add(pid, "메타", r.기대학년 ?? null, r.근거 ?? null);
  }
  for (const r of contentRows) {
    const pid = r.externalId ? idOf.get(r.externalId) : (r.problemId ?? r.id);
    if (pid) add(pid, "본문", null, r.신호 ?? null);
  }
  for (const r of elemRows) add(r.id, "초등", null, r.근거?.join(",") ?? null);

  // DB 에서 현재 상태를 채운다 — 보고서는 실물과 맞아야 한다.
  const ids = [...merged.keys()];
  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      externalId: true,
      source: true,
      content: true,
      unit: { select: { grade: true, chapter: true, section: true } },
    },
  });
  for (const row of rows) {
    const f = merged.get(row.id)!;
    f.externalId = row.externalId;
    f.source = row.source;
    f.현재단원 = `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`;
    f.본문 = row.content.slice(0, 140).replace(/\s+/g, " ");
    f.확신도 = confidenceOf(f.축, f.기대학년);
  }

  const list = [...merged.values()].sort((a, b) => {
    const rank = { 상: 0, 중: 1, 하: 2 } as const;
    return rank[a.확신도] - rank[b.확신도] || b.축.length - a.축.length;
  });

  const byAxis = new Map<string, number>();
  for (const f of list)
    byAxis.set(f.축.join("+"), (byAxis.get(f.축.join("+")) ?? 0) + 1);
  const byConf = new Map<string, number>();
  for (const f of list) byConf.set(f.확신도, (byConf.get(f.확신도) ?? 0) + 1);
  const bySource = new Map<string, number>();
  for (const f of list)
    bySource.set(f.source, (bySource.get(f.source) ?? 0) + 1);

  console.log(
    `\n합집합 교정 대상: ${list.length}건 / 전체 47,152 (${((list.length / 47152) * 100).toFixed(2)}%)`,
  );
  console.log(
    "축 조합별:",
    [...byAxis].map(([k, v]) => `${k} ${v}`).join(" · "),
  );
  console.log(
    "확신도별:",
    [...byConf].map(([k, v]) => `${k} ${v}`).join(" · "),
  );
  console.log(
    "source별:",
    [...bySource].map(([k, v]) => `${k} ${v}`).join(" · "),
  );
  console.log(
    `목적지(기대학년)를 아는 것: ${list.filter((f) => f.기대학년).length}`,
  );

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        생성: "scripts/classify/consolidate-unit-audit.ts",
        분모: { 전체문항: 47152 },
        합집합: list.length,
        축조합별: Object.fromEntries(byAxis),
        확신도별: Object.fromEntries(byConf),
        source별: Object.fromEntries(bySource),
        목적지있음: list.filter((f) => f.기대학년).length,
        목록: list,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`\n보고서: ${OUT}`);
}

main().finally(() => prisma.$disconnect());
