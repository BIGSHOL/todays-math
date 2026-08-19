#!/usr/bin/env bash
# 원문자 계열 규칙을 **하나씩 망가뜨려** 회귀 가드가 실제로 빨개지는지 본다.
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18).
#
#   bash scripts/qa/mutate-circled-glyphs.sh
#
# 🔴 **초록과 «표적 없음»을 가른다.** 2026-08-19 에 계열표를 한 곳으로 옮겼더니
#    이 스크립트의 표적 다섯이 사라졌는데 표에는 **초록으로** 보였다 —
#    「가드가 안 잡았다」와 「시험을 못 했다」가 같은 칸에 들어가면,
#    코드를 옮긴 날 가드가 통째로 죽어도 아무도 모른다.
set -u
GLYPH=src/lib/math/circledNumber.ts
NOTE=scripts/qa/answer-notation.ts
TESTS="src/__tests__/unit/answerNotation.test.ts src/__tests__/unit/circledNumber.test.ts src/__tests__/unit/circledGlyphsJson.test.ts"

# 🔴 죽은 실행이 남긴 변이를 먼저 되돌린다 — trap 은 강제 종료 때 안 돈다.
#    2026-08-19 에 실제로 그렇게 죽어 `if (false)` 7곳이 정상 diff 안에 숨었다.
for f in "$GLYPH" "$NOTE"; do
  if [ -f "$f.bak" ]; then
    echo "⚠️ 지난 실행이 죽어 있었다 — 되돌린다: $f"; mv -f "$f.bak" "$f"
  fi
done

cp "$GLYPH" "$GLYPH.bak"; cp "$NOTE" "$NOTE.bak"
trap 'mv -f "$GLYPH.bak" "$GLYPH"; mv -f "$NOTE.bak" "$NOTE"' EXIT

tests() { npx vitest run $TESTS >/dev/null 2>&1 && echo PASS || echo FAIL; }
BASE=$(tests)
echo "원본: $BASE"
[ "$BASE" = "PASS" ] || { echo "원본이 이미 빨강이다 — 먼저 고칠 것."; exit 1; }
echo

red=0; green=0; missing=0
restore() { cp "$GLYPH.bak" "$GLYPH"; cp "$NOTE.bak" "$NOTE"; }

apply() {   # apply <파일> <old> <new> → 0 적용 / 3 표적 없음
  python - "$1" "$2" "$3" <<'PY'
import io, sys, os
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8", newline="").read()
if old not in s:
    sys.stderr.write("표적 없음: " + old[:70] + "\n")
    raise SystemExit(3)
tmp = p + ".tmp"
f = io.open(tmp, "w", encoding="utf-8", newline=""); f.write(s.replace(old, new, 1)); f.close()
os.replace(tmp, p)
PY
}

mutate() {   # mutate <파일> <old> <new> <설명>
  restore
  if ! apply "$1" "$2" "$3"; then
    missing=$((missing+1)); echo "⛔ 표적 없음  $4   ← 코드가 옮겨졌다. 이건 초록이 아니다."
    return
  fi
  if [ "$(tests)" = "$BASE" ]; then
    green=$((green+1)); echo "🟢 안 바뀜   $4"
  else
    red=$((red+1));    echo "🔴 빨강      $4"
  fi
}

echo "=== 계열표 (circledNumber.ts — **한 곳**) ==="
mutate "$GLYPH" '  { base: 0x2780, size: 10, name: "sans-circled" }, // ➀..➉
' '' "➀ 계열(U+2780)을 표에서 지운다"
mutate "$GLYPH" '  { base: 0x2776, size: 10, name: "negative-circled" }, // ❶..❿
' '' "❶ 계열(U+2776)을 표에서 지운다"
mutate "$GLYPH" 'if (cp >= f.base && cp < f.base + f.size) return cp - f.base + 1;' \
                'if (cp >= f.base && cp <= f.base + f.size) return cp - f.base + 1;' \
                "계열 경계를 한 칸 넘겨 본다 (<= 로)"
mutate "$GLYPH" 'return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : null;' \
                'return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n) : null;' \
                "정규형이 한 칸 밀린다 (③ → ④)"
mutate "$GLYPH" 'export const BODY_CHOICE_MARKS = Array.from({ length: 15 }' \
                'export const BODY_CHOICE_MARKS = Array.from({ length: 5 }' \
                "본문 보기 마커를 ①..⑤ 로 좁힌다"
mutate "$GLYPH" 'export const CHOICE_MARKS = Array.from({ length: 10 }' \
                'export const CHOICE_MARKS = Array.from({ length: 9 }' \
                "지면 마커를 아홉 개로 줄인다 (JSON 드리프트 가드가 잡아야 한다)"

echo
echo "=== 정본 (answer-notation.ts) ==="
mutate "$NOTE" 'return circledValueRaw(repairGlyphs(ch));' \
               'return circledValueRaw(ch);' \
               "PUA 를 펴지 않고 읽는다"
mutate "$NOTE" '    const g = canonicalCircled(circledValue(ch));
    if (g) out.push(g);' \
               '    if (circledValue(ch)) out.push(ch);' \
               "정규형으로 모으지 않고 원래 글리프를 돌려준다"

echo
echo "변이 $((red+green+missing))개 중 빨강 $red · 초록 $green · ⛔ 표적 없음 $missing"
if [ "$missing" -gt 0 ]; then
  echo "⛔ **표적을 못 찾은 변이가 있다.** 초록이 아니라 «시험을 못 했다»는 뜻이다."
  exit 1
fi
if [ "$green" -gt 0 ]; then
  echo "🔴 초록으로 남은 변이가 있다 — 그 검사가 아무것도 안 가르거나 픽스처가 경계를 안 가른다."
  exit 1
fi
