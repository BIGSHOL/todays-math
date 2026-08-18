#!/usr/bin/env bash
# 가드를 하나씩 망가뜨려 **실제로 멈추는지** 본다.
#
# 왜: 덧칠(그림 상한·번호 서식)이 안 먹으면 그 조건은 기준선과 **똑같이** 그려지고,
# 표에는 「45mm 로도 별로 안 줄었다」/「D 인데 안 늘었다」가 그럴듯하게 찍힌다.
# 이 검토가 가장 듣고 싶은 답이라 아무도 의심하지 않는다.
# 가드는 망가뜨려 봐야 가드인 줄 안다(CLAUDE.md 2026-08-18).
#
#   bash scripts/qa/mutate-cap-layout-guards.sh
set -u
PROBE=scripts/qa/capLayoutProbe.ts
LAYOUT=scripts/qa/idLayouts.ts
cp "$PROBE" /tmp/_capLayoutProbe.orig.ts
cp "$LAYOUT" /tmp/_idLayouts.orig.ts

restore() {
  cp /tmp/_capLayoutProbe.orig.ts "$PROBE"
  cp /tmp/_idLayouts.orig.ts "$LAYOUT"
}

mutate() {
  local name="$1" file="$2" from="$3" to="$4"; shift 4
  restore
  python - "$file" "$from" "$to" <<'PY'
import io, sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding='utf-8').read()
if a not in s:
    sys.stderr.write('PATTERN NOT FOUND\n'); sys.exit(3)
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP   $name (패턴 없음)"; return; fi
  if npx tsx scripts/qa/measure-cap-layout.tsx "$@" >/tmp/_mut.log 2>&1; then
    echo "🟢 통과  $name  <-- 가드가 아니다"
  else
    echo "🔴 멈춤  $name  ($(grep -a -o 'Error: .*' /tmp/_mut.log | tail -1 | cut -c1-110))"
  fi
}

mutate "그림 묶음 표식을 안 붙인다" "$PROBE" \
  "return html.split(FIGURE_ROW_MARKER).join(" \
  "return html.split(FIGURE_ROW_MARKER + ' never').join(" \
  --take 60 --cap cap45 --layout base

mutate "그림 상한 덧칠을 안 넣는다" "$PROBE" \
  'css: `@media print{[data-paper-view] .figureRow img{max-width:${mm}mm !important}}`,' \
  'css: ``,' \
  --take 60 --cap cap45 --layout base

mutate "권고안 덧칠에서 5장+ 줄을 뺀다" "$PROBE" \
  '  [data-paper-view] .figureRow:has(img:nth-of-type(5)) img{max-width:29mm !important}' \
  '' \
  --take 2600 --cap policy --layout base

mutate "권고안 덧칠에서 2장+ 줄을 뺀다" "$PROBE" \
  '  [data-paper-view] .figureRow:has(img:nth-of-type(2)) img{max-width:45mm !important}' \
  '' \
  --take 2600 --cap policy --layout base

mutate "번호 서식 CSS 를 안 넣는다" "$LAYOUT" \
  "  css: ruleCss(paddingBottomPx, marginBottomPx)," \
  "  css: undefined," \
  --take 60 --cap cap70 --layout d

mutate "식별자 주입을 조용히 끈다" "$LAYOUT" \
  '    `<span class="idMark idRight">${SAMPLE_ID}</span>` +' \
  '    "" +' \
  --take 60 --cap cap70 --layout d

restore
echo "원복 완료"
