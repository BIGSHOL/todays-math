#!/usr/bin/env bash
# 탐침 자·판정기의 상수와 항을 **하나씩 망가뜨려** 가드가 실제로 빨개지는지 본다.
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18 — 앞 트랙에서 13개 중
# 3개가 초록이었고 셋 다 픽스처가 경계를 안 갈랐기 때문이었다).
#
#   bash scripts/qa/mutate-figref-ruler.sh
#
# 두 가지를 같이 본다.
#   ㉠ 회귀 가드   src/__tests__/unit/figrefLayout.test.ts  (실측 리터럴)
#   ㉡ 실측 채점   score-figref-ruler.ts 의 네 시안 성적    (Chromium 실측이 정답)
# 둘 중 하나라도 움직이면 «빨강»이다. ㉡ 만 보면 그 시안이 안 쓰는 항의 변이를
# 놓치고, ㉠ 만 보면 픽스처가 안 가르는 자리를 놓친다.
set -u
RULER=scripts/qa/figrefRuler.ts
RULES=scripts/qa/report-figref-layout.ts
TEST=src/__tests__/unit/figrefLayout.test.ts
JSON=${1:-scripts/qa/reports/figref-layout-stem70.json}

cp "$RULER" "$RULER.bak"
cp "$RULES" "$RULES.bak"
trap 'mv -f "$RULER.bak" "$RULER"; mv -f "$RULES.bak" "$RULES"' EXIT

score() {
  if [ -f "$JSON" ]; then
    npx tsx scripts/qa/score-figref-ruler.ts "$JSON" 2>/dev/null | grep -E '^\| (ㄱ|ㄴ|ㄷ|ㄹ)-'
  fi
}
tests() {
  npx vitest run "$TEST" --reporter=dot >/dev/null 2>&1 && echo PASS || echo FAIL
}

BASE_SCORE=$(score)
BASE_TESTS=$(tests)
echo "원본: 회귀 가드 $BASE_TESTS · 실측 채점"
echo "$BASE_SCORE" | sed "s/^/        /"
if [ "$BASE_TESTS" != "PASS" ]; then
  echo "⚠️  원본에서 이미 빨강이다 — 변이 시험이 의미가 없다. 먼저 고칠 것."
  exit 1
fi
echo

red=0; green=0
mutate() {
  cp "$RULER.bak" "$RULER"; cp "$RULES.bak" "$RULES"
  python - "$1" "$2" "$3" <<'PY'
import io,sys
p,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8").read()
assert old in s, "변이 대상을 못 찾았다: " + old
io.open(p,"w",encoding="utf-8").write(s.replace(old,new,1))
PY
  t=$(tests); c=$(score)
  if [ "$t" = "$BASE_TESTS" ] && [ "$c" = "$BASE_SCORE" ]; then
    green=$((green+1)); echo "🟢 안 바뀜   $4"
  else
    red=$((red+1))
    echo "🔴 바뀜      $4   (회귀 가드 $t)"
  fi
}

# ── 자(figrefRuler.ts) ────────────────────────────────────────────────────
mutate "$RULER" "CHOICE_FIG_COL_GAP = 16" "CHOICE_FIG_COL_GAP = 8"   "열 사이 간격 16 → 8"
mutate "$RULER" "CHOICE_MARK_WIDTH = 12.5" "CHOICE_MARK_WIDTH = 6"   "마커 폭 12.5 → 6"
mutate "$RULER" "CHOICE_MARK_GAP = 6" "CHOICE_MARK_GAP = 0"          "마커 간격 6 → 0"
mutate "$RULER" "CHOICE_BELOW_GAP = 2" "CHOICE_BELOW_GAP = 10"       "번호 아래 간격 2 → 10"
mutate "$RULER" "? Math.max(line, scaled)" "? scaled"                "번호 옆에서 마커 줄높이 무시"
mutate "$RULER" "Math.ceil(figures.length / options.cols)" "1"       "격자를 늘 한 줄로 본다"
mutate "$RULER" "total + choiceRowGap * (rows - 1)" "total"          "줄 사이 간격을 안 센다"
mutate "$RULER" "let total = choiceGridTop;" "let total = 0;"        "격자 위 여백(mt-4)을 안 센다"
mutate "$RULER" "Math.min(1, width / w)" "1"                         "칸에 맞춰 줄이는 것을 안 한다"
mutate "$RULER" "const h = figure ? figure.height : UNKNOWN_FIGURE_HEIGHT_PX;" "const h = figure ? figure.height : 0;" "치수를 모르는 그림을 0으로 센다"
mutate "$RULER" '.replace(/\[그림\]/g, "")' '.replace(/\[그림\]/g, "[그림]")' "표시를 안 지운다"
mutate "$RULER" "!EMPTY_CHOICE_LINE.test(line)" "true"               "빈 보기 줄을 안 지운다"

# ── 판정기(report-figref-layout.ts) ───────────────────────────────────────
mutate "$RULES" 'if (f.answerMax > f.choiceCells) return "규약모순";' "" "정답 열쇠를 뺀다"
mutate "$RULES" 'if (f.choiceCells !== 5 && f.choiceCells !== 4) return "규약모순";' "" "보기 칸 수 열쇠를 뺀다"
mutate "$RULES" "f.choiceCells !== 5 && f.choiceCells !== 4" "f.choiceCells < 3" "보기 칸 문턱을 3으로 내린다"
mutate "$RULES" 'if (f.marksInQuestion !== f.figures - f.choiceCells) return "규약모순";' "" "발문 몫 검사를 뺀다"
mutate "$RULES" 'if (f.answerMax === 0) return "미분류";' "" "정답을 못 읽어도 «가능» 쪽으로 흐르게 한다"
mutate "$RULES" "f.marks > f.marksInQuestion + f.marksInChoices" "false" "사라진 표시 검사를 뺀다"
mutate "$RULES" 'if (f.figures < f.answerMax) return "그림부족";' "" "그림 부족 검사를 뺀다"

echo
echo "변이 $((red+green))개 중 빨강 $red · 초록 $green"
