#!/usr/bin/env bash
# 진도 판정기의 가드를 **하나씩 망가뜨려** 시험이 빨개지는지 본다.
#
#   bash scripts/qa/mutate-eywa-resolve.sh
#
# 순서가 중요하다 (CLAUDE.md 2026-08-20 · 2026-08-21):
#   ⑴ 파일이 바뀌었나      — 안 바뀌면 치환이 실패한 것이다. **판정하지 않는다.**
#   ⑵ **산출물이 바뀌었나** — 파일이 바뀌어도 동작이 그대로면 그 변이는 무효다.
#                             여기서 판정하면 「가드가 아니다」가 거짓말이 되고,
#                             멀쩡한 가드를 의심하고 고치러 간다.
#   ⑶ 그제서야 시험이 빨개지나
set -uo pipefail
cd "$(dirname "$0")/../.."

SRC=src/lib/eywa/resolveProgress.ts
TEST=src/__tests__/unit/eywaResolveProgress.test.ts
PROBE=scripts/qa/probe-eywa-resolve.ts
BACKUP=$(mktemp)
BASE=$(mktemp)
NOW=$(mktemp)

cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
trap 'restore; rm -f "$BACKUP" "$BASE" "$NOW"' EXIT

npx tsx "$PROBE" > "$BASE" 2>/dev/null || { echo "베이스라인 계량기가 안 돈다"; exit 1; }
echo "베이스라인 산출물 $(wc -c < "$BASE") 바이트"
echo

pass=0; fail=0

mutate() { # 이름  찾을것  바꿀것
  local name="$1"; local from="$2"; local to="$3"
  restore
  # 따옴표 heredoc + 환경변수로 넘긴다 — 백틱·${} 을 bash 가 안 건드리게.
  MUT_FROM="$from" MUT_TO="$to" MUT_SRC="$SRC" python - <<'PY'
import os, io
src = os.environ["MUT_SRC"]
text = io.open(src, encoding="utf-8").read()
frm, to = os.environ["MUT_FROM"], os.environ["MUT_TO"]
if frm not in text:
    raise SystemExit("찾을 문자열이 없다: " + frm[:60])
io.open(src, "w", encoding="utf-8", newline="").write(text.replace(frm, to, 1))
PY
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "⛔ [$name] 치환 실패 — **판정하지 않는다**"
    fail=$((fail+1)); return
  fi
  if cmp -s "$SRC" "$BACKUP"; then
    echo "⛔ [$name] 파일이 안 바뀌었다 — **판정하지 않는다**"
    fail=$((fail+1)); return
  fi
  if ! npx tsx "$PROBE" > "$NOW" 2>/dev/null; then
    echo "🔴 [$name] 계량기가 터진다 (동작이 바뀌었다) → 가드 확인으로 진행"
  elif cmp -s "$BASE" "$NOW"; then
    echo "⛔ [$name] **산출물이 그대로다** — 변이가 무효하거나 표본이 그 자리를 안 본다. 판정하지 않는다"
    fail=$((fail+1)); return
  fi
  if npx vitest run "$TEST" >/dev/null 2>&1; then
    echo "🟢 [$name] 초록 ← **가드가 아니다**"
    fail=$((fail+1))
  else
    echo "🔴 [$name] 빨강 ← 가드가 지키고 있다"
    pass=$((pass+1))
  fi
}

mutate "① 느슨한 일치를 정확보다 먼저 본다" \
  "for (const loose of [false, true]) {
    const hit = lookup(index, raw, loose);" \
  "for (const loose of [true, false]) {
    const hit = lookup(index, raw, loose);"

mutate "② 후보가 여럿이어도 첫째를 고른다 (애매 없앰)" \
  "  return { kind: \"애매\", units: groups.flatMap((g) => g.units), raw };" \
  "  return { kind, units: groups[0]!.units, raw };"

mutate "③ 초등 차시 접두사를 두 토막까지만 벗긴다" \
  "const ORDINAL = /^(?:\\d+(?:-\\d+)+|\\d+\\.)\\s*/;" \
  "const ORDINAL = /^(?:\\d+-\\d+|\\d+\\.)\\s*/;"

mutate "④ 느슨한 열쇠에서 로마숫자를 안 바꾼다" \
  "    .replace(/[ⅠⅡⅢⅣⅤ]/g, (m) => ROMAN[m] ?? m)" \
  "    .replace(/[ⅠⅡⅢⅣⅤ]/g, (m) => m)"

mutate "⑤ 하루치에서 마지막 줄만 본다" \
  "  for (const line of (text ?? \"\").split(/\\r?\\n/)) {" \
  "  for (const line of (text ?? \"\").split(/\\r?\\n/).slice(-1)) {"

mutate "⑥ 시험기간도 «현재 진도»로 센다" \
  "    if (!PROGRESS_KINDS.has(verdict.kind)) continue;" \
  "    if (verdict.kind === \"미분류\" || verdict.kind === \"빈줄\") continue;"

mutate "⑦ 동점이어도 가까운 쪽을 고른다 (못 가른 것을 가른 척)" \
  "    if (scored.length > 1 && scored[0]!.d !== scored[1]!.d)" \
  "    if (scored.length > 1)"

echo
echo "가드가 지킨 변이 $pass · 안 지킨/판정불가 $fail"
[ "$fail" -eq 0 ] || exit 1
