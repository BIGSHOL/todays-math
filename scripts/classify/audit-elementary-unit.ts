/**
 * 초등 단원에 배정된 문항의 오분류를 전수 판정한다. **읽기 전용 · 보고만 한다.**
 *
 *   npx tsx scripts/classify/audit-elementary-unit.ts
 *
 * 왜 초등만 따로 보나: 이관 원본(N드라이브 기출)은 **전부 중·고등 시험지**다
 * (`school` 이 전부 「…중」/「…고」). 그래서 초등 단원에 붙은 기출은 그 자체가 오분류 신호다.
 * 게다가 규모가 712건뿐이라 **전수를 눈으로 확인할 수 있는** 유일한 구간이다.
 *
 * 근본 원인(2026-08-17 육안 확인): 이관 매퍼가 **소단원 이름만 보고 학년을 안 봤다.**
 * 「점의 이동」(초4) ← 고1 평행이동, 「이등변삼각형의 성질」(초4) ← 중2 외심·내심,
 * 「최대공약수 구하는 방법」(초5) ← 중1 소인수분해 처럼 이름은 맞고 학년만 틀린 것들이다.
 *
 * ⚠️ 이 스크립트는 **초등 배정분만** 본다. 중·고등 사이의 오분류는
 *    `audit-metadata-unit.ts`(메타 근거) · `audit-content-unit.ts`(본문 근거) 가 맡는다.
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REPORT = "scripts/classify/reports/elementary-unit-mismatch.json";

/**
 * 초등 교육과정에 **없는** 표기·개념. 하나라도 나오면 초등 배정은 의심이다.
 */
/**
 * 표기 근거 — LaTeX·기호. **원문**에 대고 본다(공백을 지우면 수식이 뭉개진다).
 */
const NOTATION_MARKERS: Array<[string, RegExp]> = [
  ["지수표기", /\^\{?[-\d]/],
  ["제곱근", /\\sqrt|√/],
  ["미지수", /\$[^$]*\b[a-zA-Z]\b[^$]*\$/],
];

/**
 * 어휘 근거 — 한글 개념어. **공백을 지운 사본**에 대고 본다.
 *
 * ⚠️ 그래서 이 패턴들에는 **공백을 넣으면 안 된다.** 본문만 뭉개고 패턴에 공백을 남기면
 * 원문(OCR 공백 때문에)에도, 뭉갠 사본(패턴 공백 때문에)에도 안 맞아 **양쪽에서 죽는다.**
 * 실제로 「경우의 수」·「삼각형을 만들 수」·「이등변삼각형의 성질」이 그렇게 0건이었다.
 * 아래 SELF_TEST 가 이 부류의 재발을 막는다.
 */
const LEXICAL_MARKERS: Array<[string, RegExp]> = [
  ["소인수분해", /소인수|서로소/],
  ["음수", /음수|음의정수/],
  ["중등도형", /합동|닮음|외심|내심|무게중심|이등변삼각형의성질|대각선의개수/],
  // ↓ 「정상」 판정 쪽을 눈으로 훑다가 찾은 누락분. 눈으로 안 봤으면 못 찾았다.
  ["내각·외각", /내각|외각/],
  ["삼각형결정조건", /삼각형을만들수(있|없)/],
  ["작도·증명", /작도|증명하시오|맞꼭지각|엇각|동위각/],
  ["함수·방정식", /일차방정식|이차방정식|부등식|좌표평면|기울기/],
  ["확률통계", /경우의수|확률|평균과분산|표준편차/],
  ["고등", /미분|적분|로그|삼각함수|벡터|행렬|수열|극한/],
];

/**
 * 가드 자가 검증 — 각 근거가 **실제로 살아 있는지** 알려진 양성 문자열로 확인한다.
 * 0건 집계만 보고는 "그런 문항이 없는 것"과 "가드가 죽은 것"을 구별할 수 없다.
 */
const SELF_TEST: Array<[string, string]> = [
  ["지수표기", "$2^{3}\\times 5$"],
  ["제곱근", "$\\sqrt{2}$ 의 값"],
  ["미지수", "$a+b$ 의 값을 구하시오"],
  ["소인수분해", "소  인수의 곱으로 나타내시오"],
  ["음수", "음  수를 모두 고르면"],
  ["중등도형", "이등변삼각형의  성질을 이용하여"],
  ["내각·외각", "한 꼭짓점에서 내  각의 크기"],
  ["삼각형결정조건", "삼각형을 만  들 수 있으면"],
  ["작도·증명", "맞꼭지각의 크기를 증  명하시오"],
  ["함수·방정식", "일차  방정식을 풀어라"],
  ["확률통계", "일어나는 모든 경우의  수를 구하시오"],
  ["고등", "수  열의 극한값"],
];

/** 본문에서 걸린 근거 이름들. 표기는 원문, 어휘는 공백 제거 사본에 댄다. */
function markersOf(content: string): string[] {
  // ⚠️ OCR 은 단어 중간에 공백을 넣는다("삼각형을 만  들 수 있으면", "수  열").
  const squashed = content.replace(/\s+/g, "");
  return [
    ...NOTATION_MARKERS.filter(([, re]) => re.test(content)),
    ...LEXICAL_MARKERS.filter(([, re]) => re.test(squashed)),
  ].map(([name]) => name);
}

function runSelfTest(): void {
  const dead = SELF_TEST.filter(
    ([name, sample]) => !markersOf(sample).includes(name),
  );
  if (dead.length) {
    throw new Error(
      `죽은 가드: ${dead.map(([n]) => n).join(", ")} — 패턴에 공백이 남아 있는지 확인할 것`,
    );
  }
  console.log(`가드 자가 검증 통과 (${SELF_TEST.length}종)\n`);
}

async function main() {
  runSelfTest();

  const rows = await prisma.problem.findMany({
    where: { unit: { grade: { startsWith: "초" } } },
    select: {
      id: true,
      externalId: true,
      source: true,
      content: true,
      unit: { select: { grade: true, chapter: true, section: true } },
    },
  });
  console.log(`초등 단원에 배정된 문항 전수: ${rows.length}건\n`);

  const hits: Array<{ r: (typeof rows)[number]; marks: string[] }> = [];
  for (const r of rows) {
    const marks = markersOf(r.content);
    if (marks.length) hits.push({ r, marks });
  }
  console.log(
    `중등 이상 표기·개념이 섞인 것: ${hits.length} / ${rows.length} (${((hits.length / rows.length) * 100).toFixed(1)}%)`,
  );

  const byGrade = new Map<string, { 의심: number; 전체: number }>();
  for (const r of rows) {
    const cur = byGrade.get(r.unit.grade) ?? { 의심: 0, 전체: 0 };
    cur.전체 += 1;
    byGrade.set(r.unit.grade, cur);
  }
  for (const h of hits) byGrade.get(h.r.unit.grade)!.의심 += 1;

  console.log("\n학년별 (의심/전체):");
  for (const [grade, v] of [...byGrade].sort()) {
    console.log(
      `  ${grade}: ${v.의심} / ${v.전체} (${((v.의심 / v.전체) * 100).toFixed(0)}%)`,
    );
  }

  const markCount = new Map<string, number>();
  for (const h of hits)
    for (const m of h.marks) markCount.set(m, (markCount.get(m) ?? 0) + 1);
  // 0건이어도 여기서는 「그런 문항이 없다」로 읽어도 된다 — 가드가 살아 있음은 runSelfTest 가 보장한다.
  console.log("\n근거별:");
  for (const [name] of [...NOTATION_MARKERS, ...LEXICAL_MARKERS]) {
    console.log(`  ${name}: ${markCount.get(name) ?? 0}`);
  }

  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        생성: "scripts/classify/audit-elementary-unit.ts",
        분모: { 초등배정문항: rows.length },
        의심: hits.length,
        학년별: Object.fromEntries(byGrade),
        근거별: Object.fromEntries(
          [...NOTATION_MARKERS, ...LEXICAL_MARKERS].map(([n]) => [
            n,
            markCount.get(n) ?? 0,
          ]),
        ),
        목록: hits.map((h) => ({
          id: h.r.id,
          externalId: h.r.externalId,
          source: h.r.source,
          현재단원: `${h.r.unit.grade} / ${h.r.unit.chapter} / ${h.r.unit.section}`,
          근거: h.marks,
          본문: h.r.content.slice(0, 160),
        })),
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`\n보고서: ${REPORT}`);

  console.log("\n=== 「정상」 판정 쪽 표본 15건 (놓친 것은 여기 숨는다) ===");
  const suspect = new Set(hits.map((h) => h.r.id));
  for (const r of rows.filter((x) => !suspect.has(x.id)).slice(0, 15)) {
    console.log(`[${r.source}] ${r.unit.grade} / ${r.unit.section}`);
    console.log(`   ${r.content.slice(0, 90).replace(/\n/g, " ")}`);
  }
}

main().finally(() => prisma.$disconnect());
