/**
 * `npm run test` — **vitest 를 돌리고, «안 돈 파일»이 있으면 실패시킨다.**
 *
 * ## 왜 감싸나
 *
 * 2026-08-19 에 오르카 한글 워크트리에서 `heightCacheManifest.test.ts` 가
 * **워커째 죽고 있었다**(노드 `rmSync` 버그, `probe-rmsync-crash.mjs` 참조).
 * 그런데 vitest 요약은 이렇게 적었다:
 *
 *     Test Files  119 passed (121)
 *          Tests  1904 passed (1904)
 *
 * **「119 passed」만 읽으면 초록이다.** 괄호 안의 121 을 봐야 두 파일이 안 돌았다는
 * 것이 보이고, 그 차이를 말로 적어 주는 줄은 없다. 종료 코드는 1이지만
 * `| tail` 같은 파이프 한 번이면 사라진다 — 실제로 그렇게 지나갔다.
 *
 * 이 저장소가 여러 번 적은 「지표가 **실패를 셀 수 있는 형태**인지 먼저 확인하라」의
 * 그 자리다. 성공률이 0을 향해도, 실패가 침묵하는 경로에서는 아무것도 증명하지 못한다.
 *
 * ## 무엇을 더 보나
 *
 * 1. **모은 파일 == 결과가 있는 파일.** `vitest list --filesOnly` 로 «돌 예정»을 먼저
 *    받아 두고 결과와 **이름으로** 견준다. 하나라도 비면 어느 파일인지 찍고 실패한다.
 * 2. **처리되지 않은 오류(unhandled error)가 있으면 실패다** — 워커 사망이 여기로 온다.
 * 3. vitest 자체 종료 코드.
 *
 * ⚠️ **`numTotalTestSuites` 로 세면 안 된다.** 그건 파일이 아니라 `describe` 블록 수다
 * (이 저장소 실측: 파일 129 · 스위트 542). 처음에 그걸로 견줘 「413개가 사라졌다」는
 * 거짓 경보를 냈다 — **분모를 먼저 검산하라**는 그 자리다.
 *
 * 인자는 그대로 넘긴다: `npm run test -- src/__tests__/unit/foo.test.ts`
 * 감싸지 않은 원본이 필요하면 `npm run test:raw`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const VITEST = path.join("node_modules", "vitest", "vitest.mjs");
const tmp = mkdtempSync(path.join(os.tmpdir(), "vitest-gate-"));
const jsonPath = path.join(tmp, "result.json");

const norm = (p) => path.relative(process.cwd(), path.resolve(p)).split(path.sep).join("/");
const IS_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** 「돌 예정인 파일」을 먼저 받아 둔다 — 결과와 견줄 **본문 밖 근거**다. */
function collectExpected() {
  const r = spawnSync(process.execPath, [VITEST, "list", "--filesOnly", ...args], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return new Set(
    r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => IS_TEST_FILE.test(l))
      .map(norm),
  );
}

const expected = collectExpected();

// 사람이 보는 기본 리포터는 그대로 두고, JSON 을 **파일로** 하나 더 받는다.
const run = spawnSync(
  process.execPath,
  [VITEST, "run", ...args, "--reporter=default", "--reporter=json", `--outputFile.json=${jsonPath}`],
  { stdio: "inherit", encoding: "utf8" },
);

let report = null;
try {
  report = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch {
  /* 리포트를 못 읽는 것 자체가 아래에서 실패로 잡힌다 */
}
await rm(tmp, { recursive: true, force: true }).catch(() => {});

const 문제 = [];

if (!report) {
  문제.push("JSON 리포트를 못 읽었다 — vitest 가 리포트를 쓰기 전에 죽었을 수 있다");
} else {
  // ⑴ 모은 파일 vs 결과가 있는 파일 — **이름으로** 견준다
  const ran = new Set(
    (Array.isArray(report.testResults) ? report.testResults : [])
      .map((t) => t?.name)
      .filter(Boolean)
      .map(norm),
  );
  if (expected === null) {
    문제.push("`vitest list` 가 실패해 «돌 예정인 파일»을 못 받았다 — 견줄 근거가 없다");
  } else {
    const 사라진 = [...expected].filter((f) => !ran.has(f));
    if (사라진.length > 0) {
      문제.push(
        `**파일 ${사라진.length}개가 결과 없이 사라졌다** (모음 ${expected.size} · 결과 ${ran.size}) — ` +
          "워커가 죽었을 수 있다. 「N passed」만 보면 안 보인다:\n" +
          사라진.map((f) => `       · ${f}`).join("\n"),
      );
    }
  }
  // ⑵ 처리되지 않은 오류 — 워커 사망이 여기로 온다
  const 미처리 = report.unhandledErrors?.length ?? 0;
  if (미처리 > 0) 문제.push(`처리되지 않은 오류 ${미처리}건 — 워커 사망이 여기로 온다`);
  // ⑶ 실패 스위트
  const 실패 = report.numFailedTestSuites ?? 0;
  if (실패 > 0) 문제.push(`실패한 파일 ${실패}개`);
}

// ⑷ vitest 자신의 종료 코드
if (run.status !== 0) 문제.push(`vitest 종료 코드 ${run.status}`);

if (문제.length > 0) {
  console.error("\n🔴 게이트가 막는다 —");
  for (const m of 문제) console.error(`   · ${m}`);
  console.error(
    "\n   (이 검사는 `scripts/qa/run-tests.mjs` 다. 요약 줄의 「N passed」는" +
      "\n    안 돈 파일을 말해 주지 않는다 — 2026-08-19 에 실제로 그렇게 지나갔다.)",
  );
  process.exit(1);
}
