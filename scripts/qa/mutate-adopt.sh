#!/usr/bin/env bash
# SVG 채택 가드를 하나씩 망가뜨려 **빨개지는지** 확인한다.
# 특히 「비율 대조」는 이 트랙의 **유일한 탐지기**라 반드시 살아 있어야 한다.
set -u
F=scripts/qa/adopt-figure-svg.ts
B=$(mktemp); cp "$F" "$B"
fail=0
mutate() {
  cp "$B" "$F"
  python - "$1" "$2" <<'PY'
import io,sys
p="scripts/qa/adopt-figure-svg.ts"
s=io.open(p,encoding="utf-8").read()
old,new=sys.argv[1],sys.argv[2]
assert s.count(old)==1, f"{old!r} 이 {s.count(old)}번"
io.open(p,"w",encoding="utf-8",newline="\n").write(s.replace(old,new,1))
PY
  if npx vitest run src/__tests__/unit/adoptFigureSvg.test.ts >/dev/null 2>&1; then
    echo "  🔴 초록  $3  ← 이 가드는 아무것도 안 지킨다"; fail=1
  else
    echo "  ✅ 빨강  $3"
  fi
}
echo "변이 시험 — 가드를 끄면 빨개져야 한다"
mutate 'if (!s.svgExists)'                'if (false)'  'SVG 가 있나'
mutate 'if (blocklist.has(s.svgPath))'    'if (false)'  '눈으로 본 검수가 막았나'
mutate 'if (s.sourceMm == null || !(s.sourceMm > 0))' 'if (false)' 'mm 를 아나'
mutate 'if (diff > RATIO_TOLERANCE)'      'if (false)'  '🔴 비율이 맞나 (유일한 탐지기)'
mutate 'dims.push(Math.round(s.svgViewBox[0]), Math.round(s.svgViewBox[1]));' \
       'dims.push(s.rasterDims[0], s.rasterDims[1]);' \
                                                        '치수를 viewBox 에서 받나'
cp "$B" "$F"; rm -f "$B"
echo "원본 복구 완료"
exit $fail
