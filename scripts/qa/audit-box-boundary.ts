/** 상자 끝 경계 오판 전수 감사 (읽기 전용). */
import { PrismaClient } from "@prisma/client";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

interface Box {
  header: string;
  items: string[];
  raw: string;
}

/** parseProblemContent 가 만든 인용문 마크다운에서 상자를 되읽는다. */
function boxesOf(question: string): Box[] {
  const boxes: Box[] = [];
  let cur: string[] | null = null;
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (cur === null) cur = [];
      cur.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (cur) {
      boxes.push(toBox(cur));
      cur = null;
    }
  }
  if (cur) boxes.push(toBox(cur));
  return boxes;
}
function toBox(lines: string[]): Box {
  const paras = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    header: paras[0] ?? "",
    items: paras.slice(1),
    raw: paras.join("\n"),
  };
}

/* 의심 신호 — 상자 안에 있으면 안 되는 것들 */
const SUB_CIRCLED = /[⑴-⑽]/;
/** `(1)` 반각 — 수식 안(`$(1)~$`)이든 밖이든. 앞이 글자·닫는괄호면 함수값이다. */
const SUB_PAREN = /(?:^|[\s$\n(])\(\s*[1-9]\s*\)/;
const EXAM_HEADER =
  /\d{4}\s*년|중간고사|기말고사|학력평가|모의고사|[가-힣]{2,5}(?:중|고)등?학?교?\s*\d\s*학년/;
const SCHOOL_LINE = /[가-힣]{2,5}(?:중|고)\s*\d\s*학년/;

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  let boxProblems = 0,
    boxCount = 0;
  const flags = new Map<string, number>();
  const samples = new Map<string, Array<{ id: string; raw: string }>>();
  let headerAnywhere = 0;

  const bump = (k: string, id: string, raw: string) => {
    flags.set(k, (flags.get(k) ?? 0) + 1);
    if (!samples.has(k)) samples.set(k, []);
    const b = samples.get(k)!;
    if (b.length < 6) b.push({ id, raw });
  };

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (!rows.length) break;
    for (const r of rows) {
      const content = r.content ?? "";
      if (EXAM_HEADER.test(content)) headerAnywhere += 1;
      const { question } = parseProblemContent(content);
      const boxes = boxesOf(question);
      if (!boxes.length) continue;
      boxProblems += 1;
      boxCount += boxes.length;
      for (const box of boxes) {
        const body = box.items.join("\n");
        let bad = false;
        if (SUB_CIRCLED.test(body)) {
          bump("하위문항 ⑴", r.id, box.raw);
          bad = true;
        }
        if (SUB_PAREN.test(body)) {
          bump("하위문항 (1)", r.id, box.raw);
          bad = true;
        }
        if (EXAM_HEADER.test(body)) {
          bump("시험지 머리말", r.id, box.raw);
          bad = true;
        }
        if (SCHOOL_LINE.test(body)) {
          bump("학교명+학년", r.id, box.raw);
          bad = true;
        }
        if (/[?？]/.test(body)) {
          bump("물음표(발문 삼킴)", r.id, box.raw);
          bad = true;
        }
        if (box.items.length === 1 && box.items[0]!.length > 200) {
          bump("통짜 1항목 200자↑", r.id, box.raw);
          bad = true;
        }
        if (bad) bump("__ANY__", r.id, box.raw);
      }
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수`);
  console.log(`상자를 그린 문항 ${boxProblems}건 · 상자 ${boxCount}개\n`);
  console.log("끝 경계 의심 신호 (한 상자가 여러 신호에 걸릴 수 있다)");
  for (const [k, v] of [...flags].sort((a, b) => b[1] - a[1])) {
    if (k === "__ANY__") continue;
    console.log(
      `  ${k.padEnd(20)} ${String(v).padStart(5)}  상자의 ${((v * 100) / boxCount).toFixed(2)}%`,
    );
  }
  console.log(
    `\n  ${"의심 상자 합계".padEnd(20)} ${String(flags.get("__ANY__") ?? 0).padStart(5)}  상자의 ${(((flags.get("__ANY__") ?? 0) * 100) / boxCount).toFixed(2)}%`,
  );
  console.log(
    `\n[별건] 시험지 머리말이 본문 어딘가에 있는 문항: ${headerAnywhere}건 (${((headerAnywhere * 100) / total).toFixed(2)}%)`,
  );

  if (wantSamples) {
    for (const [k, b] of samples) {
      if (k === "__ANY__") continue;
      console.log(`\n\n### ${k}`);
      for (const s of b)
        console.log(
          `  · ${s.id.slice(0, 8)}\n${s.raw
            .split("\n")
            .map((l) => "      " + l.slice(0, 150))
            .join("\n")}`,
        );
    }
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
