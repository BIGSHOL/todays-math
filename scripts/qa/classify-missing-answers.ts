/**
 * 정답이 없는 문항을 **어디서 되찾을 수 있는지**로 가른다 (트랙 B-4).
 *
 * 왜: `(정답 없음)` 문항은 출제에서 통째로 빠진다. 그런데 지난 회차에 가장 크게
 * 회수된 두 덩어리가 전부 **이관 단계 코드 결함**이었다(RPM 정답 4,862건,
 * 보기 마커 1,319건). **AI 로 풀기 전에 원본과 이관 코드를 먼저 의심한다.**
 *
 * 갈래는 「어느 출처가 그 답을 갖고 있나」로 나눈다:
 *
 *   PDF정답면        학교가 인쇄한 정답이 있고 텍스트로 읽힌다 → 바로 채울 수 있다
 *   PDF지면에답없음   정답면에 그 번호는 있는데 `풀이 참조` 라 값이 없다
 *   PDF번호없음      그 편 정답면에 해당 번호 블록이 아예 없다
 *   PDF정답면없음     그 편에서 정답면을 못 찾았다(원본에 없는 편 20편 포함)
 *   HWP만있음        PDF 로는 못 찾지만 HWP 원본에 정답이 있다
 *   원본에도없음      RPM 원본까지 봤는데 정답이 없다
 *   역추적불가       `externalId` 가 없어 원본을 못 짚는다
 *
 *   npx tsx scripts/qa/classify-missing-answers.ts
 *   HWP_DIR=... npx tsx scripts/qa/classify-missing-answers.ts
 *
 * **DB 를 건드리지 않는다.**
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { isSeeSolution } from "./answer-notation";

const OFFICIAL_DIR = "scripts/qa/reports/official-answers";
const HWP_DIRS = (process.env.HWP_DIR ?? "scripts/qa/reports/hwp-b").split(",");
const OUT = "scripts/qa/reports/missing-answers.json";
const SENTINEL = "정답 없음";

/** `<examId>-<번호>` 꼴인지. 트랙 C 가 RPM 행에 UUID 를 채우므로 형식을 가정하면 안 된다. */
function pastExamKey(externalId: string | null): string | null {
  if (!externalId) return null;
  const at = externalId.lastIndexOf("-");
  if (at <= 0) return null;
  const exam = externalId.slice(0, at);
  const number = externalId.slice(at + 1);
  return /^\d+$/.test(exam) && /^\d+$/.test(number) ? externalId : null;
}

async function loadOfficial(): Promise<{
  items: Map<string, { parsed: string | null; text: string }>;
  exams: Set<string>;
}> {
  const items = new Map<string, { parsed: string | null; text: string }>();
  const exams = new Set<string>();
  let files: string[] = [];
  try {
    files = (await readdir(OFFICIAL_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return { items, exams };
  }
  for (const file of files) {
    const doc = JSON.parse(await readFile(`${OFFICIAL_DIR}/${file}`, "utf-8"));
    exams.add(String(doc.examId));
    for (const [number, item] of Object.entries(
      doc.items as Record<string, { parsed: string | null; text: string }>,
    )) {
      items.set(`${doc.examId}-${Number(number)}`, item);
    }
  }
  return { items, exams };
}

async function loadHwp(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const dir of HWP_DIRS) {
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const examId = Number(file.replace(/\.json$/, ""));
      if (!Number.isFinite(examId)) continue;
      let doc: { questions?: Array<{ number: number; answer: string | null }> };
      try {
        doc = JSON.parse(await readFile(`${dir}/${file}`, "utf-8"));
      } catch {
        continue;
      }
      for (const q of doc.questions ?? []) {
        const answer = (q.answer ?? "")
          .replace(/^\s*(?:정답|답)\s*[:：]?\s*/, "")
          .trim();
        if (answer) out.set(`${examId}-${q.number}`, answer);
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [{ items: official, exams }, hwp] = await Promise.all([
    loadOfficial(),
    loadHwp(),
  ]);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { answer: { contains: SENTINEL } },
      select: {
        id: true,
        source: true,
        externalId: true,
        problemType: true,
      },
    });

    const buckets = new Map<string, typeof rows>();
    const push = (key: string, row: (typeof rows)[number]) => {
      if (!buckets.has(key)) buckets.set(key, []);
      (buckets.get(key) as typeof rows).push(row);
    };

    for (const row of rows) {
      const key = pastExamKey(row.externalId);
      if (!key) {
        push(row.externalId ? "역추적불가·원본키아님" : "역추적불가", row);
        continue;
      }
      const hit = official.get(key);
      const fromHwp = hwp.get(key);
      if (hit?.parsed) {
        push("PDF정답면", row);
      } else if (fromHwp) {
        // PDF 정답면이 못 준 것을 HWP 원본이 준다. `풀이 참조` 인 소문항도 여기서 살아난다.
        push("HWP만있음", row);
      } else if (hit) {
        push(isSeeSolution(hit.text) ? "PDF지면에답없음" : "PDF읽기실패", row);
      } else if (exams.has(key.slice(0, key.lastIndexOf("-")))) {
        push("PDF번호없음", row);
      } else {
        push("PDF정답면없음", row);
      }
    }

    const recoverable = new Set(["PDF정답면", "HWP만있음"]);
    console.log("── 정답 없는 문항 갈래 ──");
    console.log(`대상 ${rows.length}건`);
    console.log(
      `공식 정답면 산출물 ${exams.size}편 · HWP 정답 ${hwp.size}문항 (${HWP_DIRS.join(" ")})`,
    );
    let ok = 0;
    for (const [key, list] of [...buckets].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const bySource = new Map<string, number>();
      for (const r of list) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
      const mark = recoverable.has(key) ? "회수가능" : "회수불가";
      if (recoverable.has(key)) ok += list.length;
      console.log(
        `  [${mark}] ${key.padEnd(16)} ${String(list.length).padStart(4)}  ${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")}`,
      );
    }
    console.log(`\n회수 가능 ${ok} / ${rows.length}`);
    console.log(
      "※ HWP 추출이 아직 도는 중이면 `HWP만있음` 은 늘어난다. 다시 돌려 볼 것.",
    );

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          total: rows.length,
          hwpDirs: HWP_DIRS,
          hwpAnswers: hwp.size,
          buckets: Object.fromEntries(
            [...buckets].map(([k, v]) => [
              k,
              {
                count: v.length,
                recoverable: recoverable.has(k),
                items: v.map((r) => ({
                  id: r.id,
                  source: r.source,
                  externalId: r.externalId,
                  problemType: r.problemType,
                  official: official.get(pastExamKey(r.externalId) ?? "")?.parsed ?? null,
                  hwp: hwp.get(pastExamKey(r.externalId) ?? "") ?? null,
                })),
              },
            ]),
          ),
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`→ ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
