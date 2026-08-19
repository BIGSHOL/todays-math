/**
 * 🔴 시연 — **되돌리기 원장이 «드라이런» 한 번에 지워진다.**
 *
 * `apply-choice-figure-discard.ts` 는 기본이 드라이런이고, 실행할 때마다 원장을
 * **무조건 덮어쓴다**(`writeFileSync(LEDGER, …)`). 그런데 `--apply` 를 한 뒤에는
 * 계획이 **비게 된다** — 잠긴 행은 `directUseAllowed=false` 라 멱등 가드에 걸리고,
 * 후보를 다시 뽑으면 아예 «출제 가능» 이 아니라서 목록에서 빠진다.
 *
 * 그래서 **적용 뒤에 아무 생각 없이 한 번 더 돌리면**(상태를 보려고, 또는 다음
 * 사람이 «드라이런이니 안전하지» 하고) 원장이 `이전상태: []` 가 되고
 * **`--revert` 는 0행을 되돌린다.** 「영구 삭제가 아니다」의 근거가 사라진다.
 *
 * 이 시연은 DB 를 한 글자도 안 쓴다. 적용 뒤의 상태를 흉내 내려고 **입력 파일만**
 * 바꾼다 — 뺄 것이 하나도 없는 입력(모두 «자동»)을 주면 계획이 비고, 그때
 * 원장이 어떻게 되는지 본다. 끝나면 전부 되돌린다.
 *
 *   node qa/adversarial/scripts/demo-ledger-clobber.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const PAIRS = "scripts/qa/reports/choice-figure-pairs.json";
const LEDGER = "scripts/qa/reports/choice-figure-discard-lock.json";
const BAK = ".bak-demo";

copyFileSync(PAIRS, PAIRS + BAK);
copyFileSync(LEDGER, LEDGER + BAK);

try {
  // ── ㉮ 「적용을 마친」 원장을 만든다 (지금 원장에 적용됨 표시만 붙인다)
  const applied = JSON.parse(readFileSync(LEDGER, "utf8"));
  applied.적용됨 = true;
  writeFileSync(LEDGER, JSON.stringify(applied, null, 1), "utf8");
  console.log(`적용 직후 원장: 이전상태 ${applied.이전상태.length}행 · 적용됨 ${applied.적용됨}`);

  // ── ㉯ 적용 뒤의 입력을 흉내 낸다 — 뺄 것이 하나도 안 나오는 상태
  const pairs = JSON.parse(readFileSync(PAIRS, "utf8"));
  for (const p of pairs) if (p.verdict === "불가") p.verdict = "자동";
  writeFileSync(PAIRS, JSON.stringify(pairs, null, 1), "utf8");

  // ── ㉰ **드라이런만** 돌린다. DB 쓰기 없음.
  execFileSync("npx", ["tsx", "scripts/qa/apply-choice-figure-discard.ts"], {
    stdio: "ignore",
    shell: true,
  });

  const after = JSON.parse(readFileSync(LEDGER, "utf8"));
  console.log(`드라이런 한 번 뒤:  이전상태 ${after.이전상태.length}행 · 적용됨 ${after.적용됨}`);
  console.log(
    after.이전상태.length === 0
      ? "\n🔴 원장이 비었다 — `--revert` 는 이제 0행을 되돌린다. 되돌릴 근거가 사라졌다."
      : "\n🟢 원장이 살아남았다.",
  );
  process.exitCode = after.이전상태.length === 0 ? 1 : 0;
} finally {
  copyFileSync(PAIRS + BAK, PAIRS);
  copyFileSync(LEDGER + BAK, LEDGER);
  unlinkSync(PAIRS + BAK);
  unlinkSync(LEDGER + BAK);
  console.log("입력·원장 되돌림 완료");
}
