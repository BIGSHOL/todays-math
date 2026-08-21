#!/usr/bin/env bash
# **높이로 나누는 분할**을 망가뜨려 보고 빨개지는지 확인한다. 초록이면 그 가드는 장식이다.
#
# 순서가 셋이다 (CLAUDE.md 2026-08-20 · 2026-08-21):
#   ⑴ 파일이 바뀌었나   — 안 바뀌면 치환이 죽은 것이다(따옴표·역슬래시 사고)
#   ⑵ **산출물이 바뀌었나** — 파일이 바뀌어도 동작이 같으면 «가드가 아니다»가 거짓말이 된다
#   ⑶ 그제서야 시험이 빨개지나
set -u
cd "$(dirname "$0")/../.."
F=src/lib/printOverflow.ts
PROBE="npx tsx scripts/qa/probe-pack-shape.ts"
T="src/__tests__/unit/printPack.test.ts src/__tests__/unit/printOverflow.test.ts src/__tests__/unit/selectFitsPage.test.ts src/__tests__/components/TestPrint.test.tsx"

cp "$F" "$F.bak"
trap 'mv "$F.bak" "$F"' EXIT

BASE="$($PROBE 2>&1)"
if [ -z "$BASE" ]; then echo "🔴 기준 산출물을 못 얻었다 — 하네스를 먼저 고칠 것."; exit 1; fi
echo "기준 산출물:"; echo "$BASE" | sed 's/^/    /'
echo

fail=0
run() {
  if cmp -s "$F" "$F.bak"; then
    echo "⛔ 판정 거부 — $1  (파일이 안 바뀌었다: 치환이 죽었다)"; fail=1; cp "$F.bak" "$F"; return
  fi
  local now; now="$($PROBE 2>&1)"
  if [ "$now" = "$BASE" ]; then
    echo "⛔ 판정 거부 — $1  (산출물이 그대로다: 표본이 그 자리를 안 본다)"; fail=1; cp "$F.bak" "$F"; return
  fi
  if npx vitest run $T >/dev/null 2>&1; then echo "🟢 초록 — $1  ← 가드가 아니다"; fail=1
  else echo "🔴 빨강 — $1"; fi
  cp "$F.bak" "$F"
}

mutate() { MUT="$1" python - <<'PY'
import io, os
p = "src/lib/printOverflow.ts"
s = io.open(p, encoding="utf-8").read()
old, new = os.environ["MUT"].split("|||")
if old not in s:
    raise SystemExit("치환 대상 없음: " + old[:80])
io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
PY
}

# ① 높이를 아예 안 본다 — 옛 고정 분할(장당 둘)로 되돌린다.
mutate 'const pairs =
      next !== undefined &&
      !assessSeat(here, shared).tooTall &&
      !assessSeat(next, shared).tooTall;|||const pairs = next !== undefined;'
run "높이를 안 보고 늘 둘씩 넣는다"

# ② 뒤 문항의 높이를 안 본다 — 앞만 보면 2번 자리가 넘친다.
mutate '!assessSeat(here, shared).tooTall &&
      !assessSeat(next, shared).tooTall;|||!assessSeat(here, shared).tooTall;'
run "짝이 될 뒤 문항의 높이를 안 본다"

# ③ 첫 장이 79px 좁은 것을 모른다.
mutate 'const shared = onFirstPage
      ? JASEUP_MEASURED_PX.firstPageSlot
      : JASEUP_MEASURED_PX.continuationSlot;|||const shared = JASEUP_MEASURED_PX.continuationSlot;'
run "첫 장 칸이 좁은 것을 모른다"

# ④ 자리 계산이 «그 장에 혼자인가»를 안 본다 — 판정이 칸을 절반으로 잰다.
mutate 'const alone = page.problems.length === 1;|||const alone = false;'
run "자리 계산이 «혼자인가»를 안 본다"

# ⑤ 읽기 순서를 안 지킨다 — 큰 문항을 뒤로 몰아 장을 아낀다.
mutate 'export function packProblems<T extends SeatProblem>(
  problems: readonly T[],
): PackedPage<T>[] {
  const pages: PackedPage<T>[] = [];|||export function packProblems<T extends SeatProblem>(
  input: readonly T[],
): PackedPage<T>[] {
  const problems = [...input].sort(
    (a, b) => assessSeat(a, 484).px - assessSeat(b, 484).px,
  );
  const pages: PackedPage<T>[] = [];'
run "읽기 순서를 안 지키고 작은 것부터 채운다"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록이거나 판정 거부인 변이가 있다 — 위를 볼 것."
exit "$fail"
