/**
 * 대장에는 그림이 있는데 DB `figureUrls` 가 빈 기출 문항을 **되붙인다**. LLM 토큰 0.
 *
 *   node scripts/figure/reconnect-figures.mjs                드라이런(집계만, 기본)
 *   ALLOW_SHARED_IMPORT=1 node scripts/figure/reconnect-figures.mjs --apply
 *   node scripts/figure/reconnect-figures.mjs --all          '그림' 이라 말하지 않는 문항까지
 *   node scripts/figure/reconnect-figures.mjs --sample 20    육안 검수용 표본 목록을 뽑는다
 *
 * ── 왜 필요한가 (2026-08-16 실측) ────────────────────────────────────────
 * 적재 경로는 추출기(textlayer)가 그 문항에 `figure` 블록을 만들었을 때만 대장을
 * 봤다(`buildReport.ts` 의 `hasFigure` 게이트). 추출기가 놓친 그림은 대장에 있어도
 * 안 붙었다 — 재연결 대상 695건 중 690건이 이 구멍이었다. 게이트는 고쳤고(같은 날),
 * 이 스크립트는 **이미 적재된 문항**을 되붙인다.
 *
 * ── 지키는 것 ────────────────────────────────────────────────────────────
 * - 공유 DB 쓰기는 기본 차단. `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있어야 한다.
 *   게이트는 DB 접속 **앞**에 둔다.
 * - `source='past_exam'` 만 손댄다. `externalId` 형식(`<examId>-<번호>`)은 출처마다
 *   다르므로 형식을 가정하지 않고 역추적 컬럼(`examId`,`questionNumber`)만 쓴다.
 * - `public/figures/` 에 **파일이 실제로 있을 때만** 붙인다. 깨진 이미지는 그림 없음보다 나쁘다.
 * - **장수가 `MAX_SHEETS` 를 넘으면 조각으로 보고 막는다**(2026-08-18 추가). 벡터로 그려진
 *   도형은 추출기가 획 뭉치별로 쪼갤 때가 있다 — 실측 2065-4 는 15장인데 첫 장이
 *   「y축과 빗금 하나」였다. 막은 것은 리포트의 `장수과다_조각의심` 에 남는다.
 * - 쓰는 컬럼은 `figure_urls`, `figure_source` 뿐이다(트랙 A 소관).
 */
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const SAMPLE = (() => {
  const i = process.argv.indexOf("--sample");
  return i < 0 ? 0 : Number(process.argv[i + 1] ?? 20);
})();

// ── 게이트: 네트워크·DB 접근 앞에 둔다 ──────────────────────────────────
if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다. 되붙이려면 ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.",
  );
  process.exit(1);
}

const MANIFEST = "scripts/figure/figure-manifest.json";
const REPORT = "scripts/qa/reports/figure-reconnect.json";

/**
 * 본문이 그림을 가리키는지 — `scripts/figure/map-figures.py` 의 `FIGURE_WORD` 와 같은
 * 엄격한 표현만 본다. '그래프'·'도형' 을 넣으면 "이차함수의 그래프는…" 이 걸려 부푼다.
 */
const FIGURE_WORD =
  /그림과\s*같|그림에서|그림은|아래\s*그림|다음\s*그림|위\s*그림|\[그림|그림처럼|그림의/;

/**
 * 한 문항에 붙일 수 있는 최대 장수. 스키마 `figureUrls` 주석의 실측치(선택지마다
 * 그림인 문항 최대 6장)를 그대로 쓴다. 이보다 많으면 그림이 아니라 **조각**이다.
 */
const MAX_SHEETS = 6;

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

try {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

  const rows = await db.$queryRawUnsafe(
    `select id, exam_id::text as exam_id, question_number, content, figure_urls
       from problem
      where source = 'past_exam'
        and exam_id is not null
        and question_number is not null`,
  );

  const stat = {
    기출_역추적가능: rows.length,
    이미_그림있음: 0,
    대장에_없음: 0,
    "제외:그림언급없음": 0,
    "제외:장수과다": 0,
    "제외:파일없음": 0,
    붙일_대상: 0,
  };
  const todo = [];
  const missingFiles = new Set();
  const tooMany = [];

  for (const r of rows) {
    if ((r.figure_urls ?? []).length > 0) {
      stat.이미_그림있음 += 1;
      continue;
    }
    const paths = manifest[r.exam_id]?.[String(r.question_number)];
    if (!paths?.length) {
      stat.대장에_없음 += 1;
      continue;
    }
    const mentioned = FIGURE_WORD.test(r.content ?? "");
    if (!mentioned && !ALL) {
      stat["제외:그림언급없음"] += 1;
      continue;
    }
    // 장수가 너무 많으면 **한 그림이 조각난 것**이다. 벡터로 그려진 도형은 추출기가
    // 획 뭉치별로 쪼개 놓을 때가 있다 — 실측 2065-4 는 15장인데 첫 장이 「y축과 빗금
    // 하나」였다. 붙이면 지면에 파편 15개가 나간다. 선택지마다 그림인 문항이 최대
    // 6장이므로(스키마 `figureUrls` 주석) 그 위는 조각으로 보고 막는다.
    // 조용히 자르지 않는다 — 아래 리포트의 `장수과다` 목록에 남는다.
    if (paths.length > MAX_SHEETS) {
      stat["제외:장수과다"] += 1;
      tooMany.push({ examId: r.exam_id, questionNumber: r.question_number, 장수: paths.length });
      continue;
    }
    // 파일이 하나라도 없으면 그 문항 전체를 건너뛴다 — 반쪽 그림은 오독을 부른다.
    const checked = await Promise.all(
      paths.map(async (p) => {
        try {
          await access(path.join("public", p));
          return true;
        } catch {
          missingFiles.add(p);
          return false;
        }
      }),
    );
    if (checked.some((ok) => !ok)) {
      stat["제외:파일없음"] += 1;
      continue;
    }
    stat.붙일_대상 += 1;
    todo.push({
      id: r.id,
      examId: r.exam_id,
      questionNumber: r.question_number,
      paths,
      mentioned,
    });
  }

  if (APPLY) {
    let done = 0;
    for (const t of todo) {
      await db.$executeRawUnsafe(
        `update "problem"
            set "figure_urls" = $1::text[], "figure_source" = 'source'
          where id = $2::uuid and source = 'past_exam'`,
        t.paths,
        t.id,
      );
      done += 1;
      if (done % 200 === 0) console.log(`  … ${done}/${todo.length}`);
    }
    stat.적재완료 = done;
  }

  const byCount = {};
  for (const t of todo) byCount[t.paths.length] = (byCount[t.paths.length] ?? 0) + 1;

  await writeFile(
    REPORT,
    JSON.stringify(
      {
        기준시각: new Date().toISOString(),
        적용: APPLY,
        범위: ALL ? "그림언급 무관" : "그림언급 O 만",
        집계: stat,
        장수분포: byCount,
        파일없어_건너뛴_경로: [...missingFiles].slice(0, 50),
        장수과다_조각의심: tooMany,
        대상: todo.map(({ id, examId, questionNumber, paths }) => ({
          id,
          examId,
          questionNumber,
          paths,
        })),
      },
      null,
      1,
    ),
    "utf8",
  );

  console.log(
    APPLY ? "── 되붙이기 완료 ──" : "── 드라이런(쓰기 없음) ──",
    ALL ? "[그림언급 무관]" : "[그림언급 O 만]",
  );
  for (const [k, v] of Object.entries(stat)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`  장수분포           ${JSON.stringify(byCount)}`);
  console.log(`  상세 → ${REPORT}`);

  if (SAMPLE > 0) {
    // 육안 검수 표본 — 시험지가 겹치지 않게 고루 고른다.
    const seen = new Set();
    const picked = [];
    for (const t of todo) {
      if (seen.has(t.examId)) continue;
      seen.add(t.examId);
      picked.push(t);
      if (picked.length >= SAMPLE) break;
    }
    await writeFile(
      "scripts/qa/reports/figure-reconnect-sample.json",
      JSON.stringify(picked, null, 1),
      "utf8",
    );
    console.log(`  육안 표본 ${picked.length}건 → scripts/qa/reports/figure-reconnect-sample.json`);
  }
} finally {
  await db.$disconnect();
}
