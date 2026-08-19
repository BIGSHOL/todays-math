#!/usr/bin/env bash
# 판정기의 열쇠·상수를 **하나씩 망가뜨려** 회귀 가드가 실제로 빨개지는지 본다.
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18).
#
#   bash scripts/qa/mutate-answer-choice-rules.sh
#
# 초록이 나오면 둘 중 하나다 — 그 검사가 아무것도 안 가르거나(지워라),
# 픽스처가 경계를 안 가르거나(픽스처를 고쳐라).
set -u
RULES=scripts/qa/answerChoiceRules.ts
PRODUCT=src/lib/problem/parseProblemContent.ts
# 원문자 계열표는 2026-08-19 에 **한 곳**으로 모았다 — 그래서 여기도 표적이 옮겼다.
CIRCLED=src/lib/math/circledNumber.ts
TEST=src/__tests__/unit/answerChoiceRules.test.ts

# ── 🔴 죽은 실행이 남긴 변이를 먼저 되돌린다 ──────────────────────────────────
# 이 스크립트는 파일을 **일부러 망가뜨렸다가** trap 으로 되돌린다. 그런데
# 타임아웃·강제 종료로 죽으면 trap 이 안 돌아 **변이가 그대로 남는다.**
# 2026-08-19 에 실제로 그렇게 됐고, 남은 변이가 **내 정상 diff 안에 숨어서**
# `if (false)` 7곳과 제품 파서의 문턱 하나가 커밋 직전까지 갔다.
# 그래서 시작할 때 `.bak` 이 있으면 그건 «지난번이 죽었다»는 뜻이므로 먼저 복원한다.
for _b in "$@" ; do : ; done
restore_stale() {
  local stale=0
  for f in "$@"; do
    if [ -f "$f.bak" ]; then
      echo "⚠️ 지난 실행이 죽어 있었다 — 되돌린다: $f"
      mv -f "$f.bak" "$f"; stale=1
    fi
  done
  [ "$stale" = "1" ] && echo
  return 0
}

restore_stale "$RULES" "$PRODUCT" "$CIRCLED"


cp "$RULES" "$RULES.bak"
cp "$PRODUCT" "$PRODUCT.bak"
cp "$CIRCLED" "$CIRCLED.bak"
trap 'mv -f "$RULES.bak" "$RULES"; mv -f "$PRODUCT.bak" "$PRODUCT"; mv -f "$CIRCLED.bak" "$CIRCLED"' EXIT

tests() {
  npx vitest run "$TEST" >/dev/null 2>&1 && echo PASS || echo FAIL
}

BASE=$(tests)
echo "원본: $BASE"
if [ "$BASE" != "PASS" ]; then
  echo "원본이 이미 빨강이다 — 변이 시험이 의미가 없다. 먼저 고칠 것."
  exit 1
fi
echo

red=0; green=0; missing=0
apply() {   # apply <파일> <old> <new> → 0 적용됨 / 3 표적 없음
  python - "$1" "$2" "$3" <<'PY'
import io,sys,os
p,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8",newline="").read()
if old not in s:
    sys.stderr.write("표적 없음: %s" % old[:70])
    raise SystemExit(3)
out=s.replace(old,new,1)
tmp=p+".tmp"
f=io.open(tmp,"w",encoding="utf-8",newline=""); f.write(out); f.close()
os.replace(tmp,p)
PY
}

restore() {
  cp "$RULES.bak" "$RULES"
  cp "$PRODUCT.bak" "$PRODUCT"
  cp "$CIRCLED.bak" "$CIRCLED"
}

judge() {   # judge <설명>
  t=$(tests)
  if [ "$t" = "$BASE" ]; then
    green=$((green+1)); echo "🟢 안 바뀜   $1"
  else
    red=$((red+1));    echo "🔴 빨강      $1"
  fi
}

mutate_file() {   # 제품 파일을 망가뜨린다
  restore
  if ! apply "$1" "$2" "$3"; then
    missing=$((missing+1)); echo "⛔ 표적 없음  $4   ← 코드가 옮겨졌다. 이건 초록이 아니다."
    return
  fi
  judge "$4"
}

mutate() {   # 판정 규칙 파일을 망가뜨린다
  restore
  if ! apply "$RULES" "$1" "$2"; then
    missing=$((missing+1)); echo "⛔ 표적 없음  $3   ← 코드가 옮겨졌다. 이건 초록이 아니다."
    return
  fi
  judge "$3"
}

mutate_circled() {   # 원문자 계열표(한 곳)를 망가뜨린다
  restore
  if ! apply "$CIRCLED" "$1" "$2"; then
    missing=$((missing+1)); echo "⛔ 표적 없음  $3   ← 코드가 옮겨졌다. 이건 초록이 아니다."
    return
  fi
  judge "$3"
}

# ── 원문자 계열 ───────────────────────────────────────────────────────────
mutate_circled "{ base: 0x2780, size: 10, name: \"sans-circled\" }, // ➀..➉" "" "dingbat ➀ 계열을 뺀다"
mutate_circled "{ base: 0x2776, size: 10, name: \"negative-circled\" }, // ❶..❿" "" "❶ 계열을 뺀다"
mutate_circled "{ base: 0x24f5, size: 10, name: \"double-circled\" }, // ⓵..⓾" "" "⓵ 계열을 뺀다"
mutate "return circledValueRaw(repairGlyphs(ch));" "return circledValueRaw(ch);" "PUA 글리프 복구를 안 한다"
mutate_circled "if (cp >= f.base && cp < f.base + f.size) return cp - f.base + 1;" "if (cp >= f.base && cp < f.base + f.size) return cp - f.base;" "번호를 1 만큼 밀어 읽는다"
mutate_circled "export const BODY_CHOICE_MARKS = Array.from({ length: 15 }" "export const BODY_CHOICE_MARKS = Array.from({ length: 5 }" "본문 보기 마커를 ①..⑤ 로 좁힌다"

# ── 라벨 자 ───────────────────────────────────────────────────────────────
mutate "return Number(/^(\\d+)/.exec(trimmed)![1]);" "return 1;" "숫자 마커를 전부 1번으로 읽는다"
mutate "  const afterDedupe = dedupeRepeatedBlock(pairs);" "  const afterDedupe = pairs;" "제품의 중복 블록 제거를 흉내 내지 않는다"
mutate ".filter((p) => p.body.length > 0)" ".filter(() => true)" "빈 보기를 안 버린다"
mutate "    bodies.some((b, i) => b !== product.choices[i])" "    false" "제품 파서와의 본문 대조를 끈다"

# ── 정답 읽기 ─────────────────────────────────────────────────────────────
mutate "    if (out.length > 0 && SEPARATOR.test(s[i]!)) {" "    if (false) {" "「①, ③」처럼 여럿인 정답을 한 개만 읽는다"
mutate "    if (value.length > 0 && at(n) === value)" "    if (value.length > 0)" "「번호. 값」의 검산을 끈다"
mutate "  if (readableAsNumber && valueHits.length === 1 && valueHits[0] !== bare)" "  if (false)" "모호 판정을 끈다"
mutate "  if (readableAsNumber && valueHits.length === 0)" "  if (readableAsNumber)" "값과 겹쳐도 번호로 읽는다"

# ── 판정 ──────────────────────────────────────────────────────────────────
mutate "  if (positions.some((p) => p.length === 0))" "  if (false)" "「정답 보기가 없다」 검사를 뺀다"
mutate "  if (positions.some((p) => p.length > 1))" "  if (false)" "「정답 번호가 두 번」 검사를 뺀다"
mutate "  if (positions.some((p, k) => p[0]! + 1 !== ref.nums[k]))" "  if (false)" "🔴 자리 검사를 뺀다 (개수만 보게 된다)"
mutate "  if (labels.some((l, i) => l !== i + 1))" "  if (false)" "「다른 보기의 번호가 어긋남」 검사를 뺀다"
mutate "  if (labels.length !== 5)" "  if (false)" "보기 칸 수 검사를 뺀다"
mutate "  if (dropped.length > 0)" "  if (false)" "버려진 보기 검사를 뺀다"
mutate "  if (runs >= 2) return \"여러 문항이 한 행에 뭉쳤다\";" "" "문항 병합 원인을 뺀다"
mutate "  if (isPermutation && labels.some((l, i) => l !== i + 1))" "  if (false)" "순서 뒤집힘 원인을 뺀다"
mutate "  if (hasInlineMarker(row.content ?? \"\", missing))" "  if (false)" "줄 중간 마커 원인을 뺀다"
mutate "  if (row.figureUrls.length >= 3) return \"보기 그림 (figref 부류)\";" "" "보기 그림 원인을 뺀다"
mutate "const fixedByLabelRendering = positions.every((p) => p.length === 1);" "const fixedByLabelRendering = true;" "「원래 번호를 찍으면 산다」를 늘 참으로"

# ── 제품이 바뀌면 알아채는가 (본문 대조가 지키는 것) ─────────────────────
# 이 자는 제품 파서를 «다시 밟는다». 제품이 바뀌면 조용히 갈라질 수 있으므로
# 제품 쪽을 흔들어 보고 가드가 빨개지는지 확인한다.
mutate_file "$PRODUCT" "if (markers.length < 2) {" "if (markers.length < 3) {" "제품 파서의 마커 최소 개수를 2 → 3 으로 (제품 드리프트)"
mutate_file "$PRODUCT" "(?:[1-9][0-9]?)[.)][ \\t]+" "(?:[1-9][0-9]?)[.][ \\t]+" "제품 마커에서 \`1)\` 꼴을 뺀다 (제품 드리프트)"

echo
echo "남는 초록 하나 — «제품 파서와의 본문 대조를 끈다» 는 픽스처로 갈리지 않는다."
echo "  이 자는 제품 파이프라인을 다시 밟으므로, 대조는 **제품이 드리프트할 때만** 발동한다."
echo "  그때는 위 두 «제품 드리프트» 변이가 보여 주듯 다른 단언이 먼저 빨개진다."
echo "  대조의 값은 규모에 있다 — 44,396건 전량에서 «판정 불가»를 0으로 유지하는 것이고,"
echo "  개발 중 실제로 내 라벨 자의 버그(31,956건 불일치)를 이 대조가 잡았다."

echo
echo "변이 $((red+green+missing))개 중 빨강 $red · 초록 $green · ⛔ 표적 없음 $missing"
if [ "$missing" -gt 0 ]; then
  echo
  echo "⛔ **표적을 못 찾은 변이가 있다.** 초록이 아니라 «시험을 못 했다»는 뜻이다."
  echo "   코드가 옮겨 갔으면 이 스크립트의 표적도 같이 옮겨라 —"
  echo "   안 그러면 가드가 통째로 죽어도 이 표는 그대로 초록으로 보인다."
  exit 1
fi
