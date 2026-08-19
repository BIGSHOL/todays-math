/**
 * 🔴 재현기 — **`rmSync` 는 경로에 한글이 있으면 노드를 죽인다.**
 *
 *   node scripts/qa/probe-rmsync-crash.mjs
 *
 * ## 무엇이 일어나나
 *
 * Node v24.13.0 · Windows. `fs.rmSync` 에 넘긴 경로가 **해석되었을 때** 비ASCII 문자를
 * 포함하면 프로세스가 종료 코드 `0xC0000409`(STATUS_STACK_BUFFER_OVERRUN)로
 * **메시지 하나 없이** 사라진다. 파일이 있든 없든 같고, **상대 경로여도 cwd 에 한글이
 * 있으면 죽는다.** `unlinkSync` 와 `fs/promises` 의 `rm` 은 멀쩡하다.
 *
 * ## 왜 이 재현기를 남기나
 *
 * 2026-08-19 에 이것 때문에 **오르카 한글 워크트리 전부에서 테스트 한 파일이 통째로
 * 죽고 있었다.** 그런데 vitest 요약은 「119 통과」라고만 적어 **한 파일이 안 돌았다는
 * 말을 안 했다** — 「N passed」만 보면 초록으로 읽힌다. 메인 워크트리는 ASCII 라
 * 아무도 못 봤다.
 *
 * 노드가 고쳐지면 이 재현기가 「전부 살아남음」을 낸다. 그때 `no-rmsync` 금지를 풀면 된다.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CHILD = `
import { rmSync, unlinkSync, mkdirSync, writeFileSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
const [dir, file, api] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const full = dir + "/" + file;
writeFileSync(full, "x");
if (api === "rmSync") rmSync(full, { force: true });
else if (api === "unlinkSync") unlinkSync(full);
else await rm(full, { force: true });
writeSync(1, "OK");
`;

const base = mkdtempSync(path.join(os.tmpdir(), "rmprobe-"));
const child = path.join(base, "child.mjs");
writeFileSync(child, CHILD, "utf8");

const CASES = [
  ["ascii", "x.png", "ASCII 경로"],
  ["한글폴더", "x.png", "폴더에 한글"],
  ["ascii", "한글.png", "파일명에 한글"],
];
const APIS = ["rmSync", "unlinkSync", "rmAsync"];

console.log(`노드 ${process.version} · ${process.platform}\n`);
console.log("API".padEnd(13) + CASES.map(([, , n]) => n.padEnd(14)).join(""));
let anyCrash = false;
for (const api of APIS) {
  const cells = CASES.map(([d, f]) => {
    const r = spawnSync(
      process.execPath,
      [child, path.join(base, d), f, api],
      { encoding: "utf8" },
    );
    const ok = r.stdout.includes("OK");
    if (!ok) anyCrash = true;
    return (ok ? "✓" : `🔴 ${r.status}`).padEnd(14);
  });
  console.log(api.padEnd(13) + cells.join(""));
}
console.log(
  anyCrash
    ? "\n🔴 죽는 조합이 있다 — `rmSync` 금지(`noRmSync.test.ts`)를 그대로 둘 것."
    : "\n✓ 전부 살아남았다 — 노드가 고쳐졌다. 금지를 풀어도 된다.",
);
// 청소도 `rmSync` 를 안 쓴다 — 이 재현기 자신이 그 지뢰를 밟으면 우스운 일이다.
await rm(base, { recursive: true, force: true }).catch(() => {});
