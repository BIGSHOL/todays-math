/**
 * 「새 문항이 기존 문항과 **같아 보이는가**」를 재는 자 (읽기 전용).
 *
 *   npx tsx scripts/qa/measure-view-convention.ts
 *
 * 원장님 지시 2026-08-19: 「후보정 철저히 해서 뷰가 현재 문제와 아주 유사한 수준으로
 * 보여야함」. 「비슷해 보인다」는 그대로는 셀 수 없다. 그래서 **갈릴 수 있는 축**을
 * 기존 데이터에서 뽑아 분포로 만들고, 새 문항이 그 분포 밖이면 이름을 찍는다.
 *
 * ⚠️ 기존 말뭉치는 **일부가 망가져 있다**(HWP 변환 잔재 — 물결 `~`, `\left(` 남용).
 *    그러니 「기존과 같게」가 곧 「망가진 것을 흉내 내라」는 아니다. 여기서 맞추는 것은
 *    **지면에 보이는 규약**(보기 마커·분수 크기)뿐이고, 잔재는 참고로만 찍는다.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface ViewShape {
  /** 보기 마커: 줄머리 `1.` / 줄머리 원문자 / 인라인 원문자 / 없음 */
  marker: "줄머리 1." | "줄머리 원문자" | "인라인 원문자" | "없음";
  dfrac: number;
  frac: number;
  tilde: number;
  leftParen: number;
  thinSpace: number;
}

/** 본문 한 건의 «보이는 모양»을 뽑는다. 세는 쪽과 고치는 쪽이 이 함수 하나를 쓴다. */
export function readShape(content: string): ViewShape {
  const lineDot = (content.match(/\n[ \t]*\d{1,2}\.[ \t]/g) ?? []).length;
  const lineCircle = (content.match(/\n[ \t]*[①-⑮]/g) ?? []).length;
  const anyCircle = (content.match(/[①-⑮]/g) ?? []).length;
  const marker: ViewShape["marker"] =
    lineDot >= 3
      ? "줄머리 1."
      : lineCircle >= 3
        ? "줄머리 원문자"
        : anyCircle >= 3
          ? "인라인 원문자"
          : "없음";
  const count = (re: RegExp) => (content.match(re) ?? []).length;
  return {
    marker,
    dfrac: count(/\\dfrac/g),
    frac: count(/\\frac/g),
    tilde: count(/~/g),
    leftParen: count(/\\left\(/g),
    thinSpace: count(/\\,/g),
  };
}

/**
 * 지면에서 **눈에 보이는 차이**를 내는 것들.
 *
 * ⚠️ 보기 마커(`1.` ↔ `①`)는 여기 없다 — 파서가 마커를 **떼고** 렌더러가
 *    `CHOICE_MARKS` 로 ①②③ 를 다시 붙이므로 **화면은 같다.** 「기존과 다르다」가
 *    곧 「달라 보인다」는 아니다. 세는 축은 실제로 보이는 것이어야 한다.
 */
export const VIEW_AXES: readonly { name: string; re: RegExp }[] = [
  { name: "\\dfrac (분수가 커진다)", re: /\\dfrac/ },
  { name: "\\frac", re: /\\frac/ },
  { name: "\\displaystyle", re: /\\displaystyle/ },
  { name: "굵게 **…** (마크다운)", re: /\*\*[^*\n]+\*\*/ },
  { name: "«…» 홑화살괄호", re: /[«»]/ },
  { name: "「…」 낫표", re: /[「」]/ },
  { name: "빈 줄(문단 나눔)", re: /\n[ \t]*\n/ },
  { name: "\\circ (도)", re: /\\circ/ },
  { name: "\\degree (도)", re: /\\degree/ },
  { name: "\\mathrm", re: /\\mathrm/ },
  { name: "\\overline", re: /\\overline/ },
  { name: "\\cdots", re: /\\cdots/ },
  { name: "CDOTS (변환 잔재)", re: /CDOTS/ },
];

async function main(): Promise<void> {
  const where = `pool='shared' AND question_type='객관식'`;
  const 기존 = (await prisma.$queryRawUnsafe(
    `SELECT content FROM problem
      WHERE ${where} AND review_status='approved' AND direct_use_allowed
        AND source <> 'ai_generated'
      ORDER BY random() LIMIT 4000`,
  )) as { content: string }[];
  const 우리 = (await prisma.$queryRawUnsafe(
    `SELECT problem_code AS code, content FROM problem
      WHERE ${where} AND source = 'ai_generated' ORDER BY problem_code`,
  )) as { code: string; content: string }[];

  const tally = (rows: { content: string }[]) => {
    const m = new Map<string, number>();
    let dfrac = 0;
    let frac = 0;
    for (const r of rows) {
      const s = readShape(r.content);
      m.set(s.marker, (m.get(s.marker) ?? 0) + 1);
      if (s.dfrac) dfrac += 1;
      if (s.frac) frac += 1;
    }
    return { m, dfrac, frac, n: rows.length };
  };

  for (const [name, rows] of [
    ["기존(표본)", 기존],
    ["우리(AI)", 우리],
  ] as const) {
    const t = tally(rows);
    console.log(`\n  [${name}] ${t.n}건`);
    for (const [k, v] of [...t.m].sort((a, b) => b[1] - a[1]))
      console.log(
        `  ${String(v).padStart(5)}  ${((100 * v) / t.n).toFixed(2).padStart(6)}%  보기 ${k}`,
      );
    console.log(
      `  ${String(t.dfrac).padStart(5)}  ${((100 * t.dfrac) / t.n).toFixed(2).padStart(6)}%  \\dfrac 쓴 문항`,
    );
    console.log(
      `  ${String(t.frac).padStart(5)}  ${((100 * t.frac) / t.n).toFixed(2).padStart(6)}%  \\frac 쓴 문항`,
    );
  }

  console.log(
    `\n  [지면에서 보이는 축 — 기존 ${기존.length} vs 우리 ${우리.length}]`,
  );
  console.log(`   기존%    우리%   축`);
  for (const ax of VIEW_AXES) {
    const a =
      (100 * 기존.filter((r) => ax.re.test(r.content)).length) / 기존.length;
    const b =
      (100 * 우리.filter((r) => ax.re.test(r.content)).length) / 우리.length;
    const 벌어짐 = Math.abs(a - b) >= 25 ? "  ← 벌어졌다" : "";
    console.log(
      `  ${a.toFixed(1).padStart(6)}  ${b.toFixed(1).padStart(6)}   ${ax.name}${벌어짐}`,
    );
  }

  // 분포 밖에 있는 우리 문항을 **이름으로** 찍는다 — 「몇 %」로는 무엇을 고칠지 모른다.
  const 다수 = [...tally(기존).m].sort((a, b) => b[1] - a[1])[0]![0];
  const 밖 = 우리.filter((r) => readShape(r.content).marker !== 다수);
  console.log(`\n  [기존 다수(${다수})와 다른 우리 문항] ${밖.length}건`);
  for (const r of 밖.slice(0, 30))
    console.log(`  ${r.code}  ${readShape(r.content).marker}`);
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("measure-view-convention")) void main();
