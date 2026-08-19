/**
 * 🔴 금지 — **`fs.rmSync` 를 쓰지 않는다.**
 *
 * 경로가 해석됐을 때 비ASCII 문자를 포함하면 Node v24.13.0(Windows)이 종료 코드
 * `0xC0000409`(STATUS_STACK_BUFFER_OVERRUN)로 **메시지 하나 없이** 죽는다.
 * 파일이 있든 없든 같고, **상대 경로여도 cwd 에 한글이 있으면 죽는다.**
 *
 * | API | 한글 경로 |
 * | --- | --- |
 * | `rmSync` | 🔴 죽음 |
 * | `unlinkSync` | ✓ |
 * | `fs/promises` 의 `rm` | ✓ |
 *
 * ## 왜 이게 무서운가 — **아무도 못 봤다**
 *
 * 메인 워크트리는 `C:/Creative/testautocreator` 라 ASCII 다. 오르카가 만드는
 * 워크트리는 `…/HWP원본회수` 처럼 한글이다. 그래서 **오르카 워크트리 전부에서
 * `heightCacheManifest.test.ts` 가 통째로 죽고 있었는데**, vitest 요약은
 * 「119 통과」라고만 적어 **한 파일이 안 돌았다는 말을 안 했다**(2026-08-19).
 *
 * 재현: `node scripts/qa/probe-rmsync-crash.mjs` — 노드가 고쳐지면 「전부 살아남음」이
 * 나온다. 그때 이 금지를 지워라.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SCAN = ["src", "scripts", "qa"];
const EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".js"]);
/** 이 파일들은 **금지를 설명하느라** 그 이름을 적는다. */
const ALLOWED = new Set([
  path.join("src", "__tests__", "unit", "noRmSync.test.ts"),
  path.join("scripts", "qa", "probe-rmsync-crash.mjs"),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

describe("`rmSync` 금지 — 한글 경로에서 노드가 죽는다", () => {
  it("저장소 어디에도 `rmSync` 호출이 없다", () => {
    const offenders: string[] = [];
    for (const root of SCAN) {
      const dir = path.join(ROOT, root);
      try {
        statSync(dir);
      } catch {
        continue; // 없는 디렉터리는 건너뛴다
      }
      for (const file of walk(dir)) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const src = readFileSync(file, "utf8");
        src.split("\n").forEach((line, i) => {
          // 주석에서 «쓰지 마라» 라고 적는 것은 막지 않는다 — 호출만 본다.
          if (
            /(?<![.\w])rmSync\s*\(/.test(line) &&
            !/^\s*(\*|\/\/|#)/.test(line)
          ) {
            offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
          }
        });
      }
    }
    expect(
      offenders,
      `${offenders.join("\n")}\n\n→ \`unlinkSync\` 또는 \`fs/promises\` 의 \`rm\` 을 써라.`,
    ).toEqual([]);
  });
});
