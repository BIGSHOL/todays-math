#!/usr/bin/env bash
# 가드를 **망가뜨려 보고** 빨개지는지 확인한다. 초록이면 그 가드는 장식이다.
# (CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야 가드인 줄 안다」)
set -u
cd "$(dirname "$0")/../.."
PROBE=scripts/qa/paperProbe.tsx
MAN=scripts/qa/heightCacheManifest.ts
TESTS="src/__tests__/unit/paperProbeParity.test.tsx src/__tests__/unit/heightCacheManifest.test.ts"
cp "$PROBE" "$PROBE.bak"; cp "$MAN" "$MAN.bak"
restore() { mv "$PROBE.bak" "$PROBE"; mv "$MAN.bak" "$MAN"; }
trap restore EXIT

fail=0
run() {
  local name="$1"
  if npx vitest run $TESTS >/dev/null 2>&1; then
    echo "🟢 초록 — $name  ← 가드가 아니다"
    fail=1
  else
    echo "🔴 빨강 — $name"
  fi
  cp "$PROBE.bak" "$PROBE"; cp "$MAN.bak" "$MAN"
}

# ① 탐침이 mm 를 안 넘긴다 (2026-08-20 에 실제로 그랬던 상태)
python -c "
import io;p='$PROBE';s=io.open(p,encoding='utf-8').read()
s=s.replace('      figureSourceMm={row.figureSourceMm}\n','')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "탐침이 figureSourceMm 을 안 넘긴다"

# ② 탐침이 원본 픽셀 치수를 안 넘긴다 (비율을 잃는다)
python -c "
import io;p='$PROBE';s=io.open(p,encoding='utf-8').read()
s=s.replace('      figureDims={row.figureDims}\n','')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "탐침이 figureDims 를 안 넘긴다"

# ③ 지문이 그림 크기 근거를 안 본다
python -c "
import io;p='$MAN';s=io.open(p,encoding='utf-8').read()
s=s.replace('  return \`\${(row.figureDims ?? []).join(\",\")}|\${(row.figureSourceMm ?? []).join(\",\")}\`;','  return \"\";')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "지문이 그림 크기 근거를 안 본다"

# ④ 앞뒤 지문 대조가 사유를 안 가린다 (늘 «안 움직였다»)
python -c "
import io;p='$MAN';s=io.open(p,encoding='utf-8').read()
i=s.index('export function describeGroundMove')
j=s.index('const reasons: string[] = [];',i)+len('const reasons: string[] = [];')
s=s[:j]+'\n  return null;'+s[j:]
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "앞뒤 지문 대조가 늘 «안 움직였다»"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
