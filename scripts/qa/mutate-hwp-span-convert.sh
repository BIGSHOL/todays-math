#!/usr/bin/env bash
# `convert-hwp-spans.py` 의 구멍 막기를 **망가뜨려** 시험이 빨개지는지 본다.
#
# 🔴 이 하네스는 「파일이 바뀌었나」가 아니라 **「산출물이 바뀌었나」**를 먼저 본다.
#    2026-08-21 에 변이 둘이 초록이었는데, 알고 보니 **동작을 안 바꾸는 변이**였다
#    (하나는 사전 이름만 바꿨고 하나는 다른 경로로 살아 있었다). 파일 비교만
#    했으면 「가드가 아니다」로 잘못 읽고 멀쩡한 시험을 고치러 갔을 것이다.
set -u
F=scripts/qa/convert-hwp-spans.py
BAK=$(mktemp)
BEFORE=$(mktemp)
cp "$F" "$BAK"
python "$F" --probe > "$BEFORE" 2>&1

run() { # $1=이름
  local after; after=$(mktemp)
  if ! python "$F" --probe > "$after" 2>&1; then
    echo "[$1] 🔴 변이가 파이썬을 죽였다 — 판정 안 함"
    cp "$BAK" "$F"; return
  fi
  if cmp -s "$BEFORE" "$after"; then
    echo "[$1] 🔴 **산출물이 그대로다 — 동작을 안 바꾸는 변이다.** 판정 안 함"
    cp "$BAK" "$F"; return
  fi
  local r
  r=$(npx vitest run src/__tests__/unit/hwpSpanConvert.test.ts 2>&1 \
        | grep -oE "Tests +[0-9]+ failed" | head -1)
  echo "[$1] ${r:-🟢 전부 초록 ← 가드가 아니다}"
  cp "$BAK" "$F"
}

# ① overline 구멍 막기를 통째로 뺀다 → 선분이 분수가 되어야 한다
python - "$F" <<'PY'
import io, re, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
s = re.sub(r'    \(\n        "overline",.*?\n    \),\n', "", s, count=1, flags=re.S)
io.open(p, "w", encoding="utf-8").write(s)
PY
run "overline 구멍 막기 제거"

# ② rarrow → \to 를 뺀다 → 극한 화살표가 ⇒ 로 돌아가야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "rarrow(?![A-Za-z])"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "rarrowZZZ(?![A-Za-z])", 1))
PY
run "rarrow→to 제거"

# ③ 어휘 떼어내기를 끈다 → 붙은 함수 이름이 그대로 남아야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '    out = _WORD.sub(rep, body)'
assert old in s
io.open(p, "w", encoding="utf-8").write(s.replace(old, "    out = body  # 변이", 1))
PY
run "어휘 떼어내기 끄기"

# ④ 「전부 대문자면 안 찢는다」를 뺀다 → `rm COF` 가 `\mathrm{C}OF` 가 되어야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "    if word.isupper() and any(len(p) < 3 for p in pieces):"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(
    s.replace(old, "    if False and any(len(p) < 3 for p in pieces):  # 변이", 1)
)
PY
run "대문자 라벨 보호 제거"

# ⑤ 숫자 앞 떼기를 다시 「세 글자 이상」으로 → `ln2` 가 안 갈라져야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "        if len(t) < 2:"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "        if len(t) < 3:  # 변이", 1))
PY
run "숫자 앞 두 글자 떼기 제거"

cmp -s "$F" "$BAK" && echo "원본 복구 확인 ok" || echo "🔴 복구 실패 — $BAK 를 보라"
