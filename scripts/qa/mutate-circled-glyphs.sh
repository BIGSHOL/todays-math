#!/bin/bash
# 가드를 **망가뜨려 본다.** 초록으로 남는 변이가 있으면 그 검사는 장식이다.
# (CLAUDE.md 2026-08-18 — 「LOOP 가 있나」로 재시도를 지켰더니 28개 전부 초록이었다.)
set -u
F=scripts/qa/answer-notation.ts
T=src/__tests__/unit/answerNotation.test.ts
BK=$(mktemp); cp "$F" "$BK"
pass=0; fail=0

run() {
  local name="$1"
  if npx vitest run "$T" >/tmp/mut.log 2>&1; then
    echo "  🟢 초록 — 이 변이를 아무도 못 잡는다: $name"; pass=$((pass+1))
  else
    echo "  🔴 빨강: $name"; fail=$((fail+1))
  fi
  cp "$BK" "$F"
}

echo "=== 원문자 계열 변이 ==="

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("  { base: 0x2780, size: 10 }, // ➀..➉\n","")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "➀ 계열(U+2780)을 표에서 지운다"

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("    const g = canonicalCircled(circledValue(ch));\n    if (g) out.push(g);",
            "    if (circledValue(ch)) out.push(ch);   // 정규형으로 안 모은다")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "정규형으로 모으지 않고 원래 글리프를 돌려준다"

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("  const cp = repairGlyphs(ch).codePointAt(0);","  const cp = ch.codePointAt(0);")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "PUA 를 펴지 않고 읽는다"

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("    if (cp >= f.base && cp < f.base + f.size) return cp - f.base + 1;",
            "    if (cp >= f.base && cp <= f.base + f.size) return cp - f.base + 1;")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "계열 경계를 한 칸 넘겨 본다 (<= 로)"

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("  { base: 0x2776, size: 10 }, // ❶..❿\n","")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "❶ 계열(U+2776)을 표에서 지운다 — 드리프트 가드가 잡아야 한다"

python - <<'PY'
import io; p="scripts/qa/answer-notation.ts"; s=io.open(p,encoding="utf-8").read()
s=s.replace("  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : null;",
            "  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n) : null;   // 한 칸 밀림")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
PY
run "정규형이 한 칸 밀린다 (③ → ④)"

cp "$BK" "$F"; rm -f "$BK"
echo
echo "변이 $((pass+fail))개 중 빨강 $fail · 초록 $pass"
[ "$pass" = "0" ] || echo "🔴 초록으로 남은 변이가 있다 — 그 검사는 장식이다."
