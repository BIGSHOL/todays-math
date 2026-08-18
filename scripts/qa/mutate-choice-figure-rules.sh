#!/usr/bin/env bash
# 규칙을 하나씩 망가뜨려 테스트가 **정말** 빨개지는지 본다.
#
# 이 저장소가 배운 것: 가드는 망가뜨려 봐야 가드인 줄 안다. 앞 조사에서 13개 중
# 3개가 초록이었고, 셋 다 픽스처가 경계를 안 갈랐기 때문이었다.
set -u
SRC=scripts/qa/choiceFigureRules.ts
TEST=src/__tests__/unit/choiceFigureRules.test.ts
ORIG=$(mktemp)
cp "$SRC" "$ORIG"

mutate() {
  local name="$1" from="$2" to="$3"
  cp "$ORIG" "$SRC"
  python - "$SRC" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
if a not in s:
    sys.stderr.write('PATTERN NOT FOUND\n'); sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP  $name (패턴 없음)"; return; fi
  if npx vitest run "$TEST" >/tmp/_mut.log 2>&1; then
    echo "🟢 초록  $name  <-- 가드가 아니다"
  else
    echo "🔴 빨강  $name"
  fi
}

mutate "마커 정규식에서 원문자를 뺀다" \
  '(?:([1-9][0-9]?)[.)][ \t]+|([①②③④⑤⑥⑦⑧⑨⑩])[ \t]*)' \
  '(?:([1-9][0-9]?)[.)][ \t]+)'
mutate "마커 정규식을 앞 자의 것으로 되돌린다 (연속 마커를 건너뛴다)" \
  '/\n[ \t]*(?:([1-9][0-9]?)[.)][ \t]+|([①②③④⑤⑥⑦⑧⑨⑩])[ \t]*)/g' \
  '/(?:^|\n)\s*([1-5])[.)]\s*/g'
mutate "첫 줄 마커를 못 잡게 한다" \
  'const text = "\n" + (content ?? "").replace(/\r\n?/g, "\n");' \
  'const text = (content ?? "").replace(/\r\n?/g, "\n");'
mutate "그림 표시가 든 줄도 «진짜 글자» 로 센다" \
  '.map((line) => (line.includes("[그림]") ? "" : line))' \
  '.map((line) => line)'
mutate "㉰ 문턱 2 -> 6 (보기 다섯으로는 못 넘는다)" \
  'return figureish >= 2;' \
  'return figureish >= 6;'
mutate "㉱ 그림 3장 이하 열쇠를 없앤다" \
  'return f.nFig >= 1 && f.nFig <= 3 && keyChoiceIsFigure(f);' \
  'return false;'
mutate "㉲ 그림 없음 열쇠를 없앤다" \
  'return f.nFig === 0 && keyChoiceIsFigure(f);' \
  'return false;'
mutate "㉯ 문턱 4 -> 99" \
  'return f.nFig >= 4 && f.nFilled < 5;' \
  'return f.nFig >= 99 && f.nFilled < 5;'
mutate "㉯ 를 무조건 참으로 (반대쪽까지 잡는다)" \
  'return f.nFig >= 4 && f.nFilled < 5;' \
  'return f.nFig >= 4;'
mutate "«미분류» 를 없애고 전부 보기글자로 민다" \
  '  else klass = "미분류";' \
  '  else klass = "보기글자";'
mutate "«무관» 울타리를 없앤다" \
  '  else if (!inScope(row)) klass = "무관";' \
  '  else if (false) klass = "무관";'
mutate "사정권에서 그림 표시를 안 본다" \
  '(row.figureUrls?.length ?? 0) > 0 || (row.content ?? "").includes("[그림]")' \
  '(row.figureUrls?.length ?? 0) > 0'
mutate "markerState 를 늘 «없음» 으로" \
  'f.markers.length === 0 ? "없음" : f.nFilled >= 5 ? "다섯" : "일부"' \
  '"없음"'
mutate "markRel 에서 표시0 을 안 가른다" \
  'f.nMark === 0' \
  'f.nMark === -1'

cp "$ORIG" "$SRC"
rm -f "$ORIG"
echo "원복 완료"
