#!/usr/bin/env bash
# 넘침 판정을 **망가뜨려 보고** 빨개지는지 확인한다. 초록이면 그 가드는 장식이다.
set -u
cd "$(dirname "$0")/../.."
F=src/lib/printOverflow.ts
T="src/__tests__/unit/printOverflow.test.ts src/__tests__/unit/printFigureHeight.test.ts src/__tests__/unit/selectFitsPage.test.ts"
cp "$F" "$F.bak"
trap 'mv "$F.bak" "$F"' EXIT
fail=0
run() {
  if npx vitest run $T >/dev/null 2>&1; then echo "🟢 초록 — $1  ← 가드가 아니다"; fail=1
  else echo "🔴 빨강 — $1"; fi
  cp "$F.bak" "$F"
}

# ① 여유를 0으로 (칸에 딱 닿아야만 경고 — 20px 안쪽 넘침을 놓친다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('export const OVERFLOW_MARGIN_PX = JASEUP_MEASURED_PX.line;','export const OVERFLOW_MARGIN_PX = 0;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "여유를 0으로 만든다"

# ② 폭 규칙을 되살린다 (사유를 덮고 헛것 337건이 돌아온다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('    if (seat.tooTall) {','    if (displayWidth(problem.content) > OVERFLOW_WIDTH_LIMIT) reasons.push(\"본문이 길다\");\n    if (!reasons.length && seat.tooTall) {')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "폭 규칙을 되살린다"

# ③ 높이 규칙을 아예 끈다
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('  const tooTall = px > slotPx - OVERFLOW_MARGIN_PX;','  const tooTall = false;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "높이 규칙을 끈다"

# ④ 칸을 안 보고 늘 이어지는 장 칸으로 본다 (첫 장이 좁은 것을 못 본다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('  const tooTall = px > slotPx - OVERFLOW_MARGIN_PX;','  const tooTall = px > JASEUP_MEASURED_PX.continuationSlot - OVERFLOW_MARGIN_PX;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "자리마다 다른 칸을 안 본다"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
