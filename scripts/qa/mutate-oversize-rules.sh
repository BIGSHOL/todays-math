#!/usr/bin/env bash
# 임시 — 규칙을 하나씩 망가뜨려 테스트가 정말 빨개지는지 본다.
set -u
SRC=scripts/qa/oversizeRules.ts
cp "$SRC" /tmp/_oversizeRules.orig.ts
mutate() {
  local name="$1" from="$2" to="$3"
  cp /tmp/_oversizeRules.orig.ts "$SRC"
  python - "$SRC" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
if a not in s:
    sys.stderr.write('PATTERN NOT FOUND\n'); sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP  $name (패턴 없음)"; return; fi
  if npx vitest run src/__tests__/unit/oversizeRules.test.ts >/tmp/_mut.log 2>&1; then
    echo "🟢 초록  $name  <-- 가드가 아니다"
  else
    echo "🔴 빨강  $name"
  fi
}

mutate "그림 라벨 조건 제거"          "      signals.figureRefs < input.figureCount" "      true"
mutate "그림 상한 6 -> 99"            "export const FIGURE_COUNT_SANE_MAX = 6;" "export const FIGURE_COUNT_SANE_MAX = 99;"
mutate "병합 문턱 3 -> 2"             "if (problemCount >= 3)" "if (problemCount >= 2)"
mutate "병합 문턱 3 -> 4"             "if (problemCount >= 3)" "if (problemCount >= 4)"
mutate "base64 몫 0.3 -> 0.9"         "signals.base64Share >= 0.3" "signals.base64Share >= 0.9"
mutate "figShare 0.5 -> 0.05"         "figShare >= 0.5" "figShare >= 0.05"
mutate "미분류 대신 본문이 길다"       'return "미분류";' 'return "본문이 정말 길다";'
mutate "그림 간격을 안 뺀다"          "return (problemColumn - figureGap * (k - 1)) / k;" "return problemColumn / k;"
mutate "줄 간격을 한 번 더 센다"      "return total + figureGap * (rows - 1);" "return total + figureGap * rows;"
mutate "폭 상한을 안 건다"            "const scale = figure ? Math.min(1, capPx / figure.width) : 1;" "const scale = 1;"
mutate "라벨을 서로 다른 것으로 안 센다" "distinctCount(content, FIGURE_LABEL)" "count(content, FIGURE_LABEL)"
mutate '묶음 지시문에 수식 기호 허용 안 함' '\$?\d+\$?\s*~\s*\$?\d+\$?' '\d+\s*~\s*\d+'
mutate "머리말에서 두 자리 연도 제외"  "/\\d{2,4}\\s*년" "/\\d{4}\\s*년"

cp /tmp/_oversizeRules.orig.ts "$SRC"
echo "원복 완료"
