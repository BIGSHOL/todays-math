#!/usr/bin/env bash
# `lsubRules.ts` 를 **망가뜨려** 시험이 빨개지는지 본다.
#
# 🔴 앵커가 없으면 판정하지 않고 멈춘다 — 「변이가 안 먹었는데 초록」을
#    「가드가 아니다」로 잘못 읽으면 멀쩡한 시험을 고치러 간다(2026-08-21).
set -u
F=scripts/qa/lsubRules.ts
BAK=$(mktemp)
cp "$F" "$BAK"

run() { # $1=이름
  if cmp -s "$F" "$BAK"; then
    echo "[$1] 🔴 **파일이 그대로다 — 변이가 안 먹었다.** 판정 안 함"
    return
  fi
  local r
  r=$(npx vitest run src/__tests__/unit/lsubRules.test.ts 2>&1 \
        | grep -oE "Tests +[0-9]+ failed" | head -1)
  echo "[$1] ${r:-🟢 전부 초록 ← 가드가 아니다}"
  cp "$BAK" "$F"
}

# ① `\pi` 를 중복순열 Π 가 아니라 소문자 π 로 둔다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '  return String.raw`\\Pi `;'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, '  return String.raw`\\pi `; // 변이', 1))
PY
run "Pi 를 pi 로"

# ② 뒤집힌 꼴(첨자가 뒤)을 안 다룬다
python - "$F" <<'PY'
import io, re, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = 'new RegExp(`${OP}${SP}${RSUB}${SP}LSUB${SP}${SUB_TAIL}`, "gi"),'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, 'new RegExp("(?!)", "gi"), // 변이', 1))
PY
run "뒤집힌 꼴 제거"

# ③ 끝첨자를 다시 탐욕스럽게 — 다음 항을 삼켜야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = 'const SUB_TAIL = `(${ATOM}(?:\\\\s*[+-]\\\\s*\\\\d+)?)`;'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, 'const SUB_TAIL = SUB; // 변이', 1))
PY
run "끝첨자를 탐욕스럽게"

# ④ 셈 검산이 늘 통과한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = 'export function verifyLsubArithmetic(latex: string): ArithCheck {'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(
    s.replace(old, old + '\n  if (latex) return { checked: true, ok: true, why: "변이" };', 1)
)
PY
run "셈 검산 무력화"

# ⑤ 셈 검산이 «한 변 전부인가»를 안 본다 → 거짓 경보가 나야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '    if (head !== "" && !/[=#]$/.test(head)) continue; // 한 변 전부가 아니다'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, '    // 변이', 1))
PY
run "한 변 검사 제거"

# ⑥ `[PCH]` 에 낱말 경계를 붙인다 → 붙어 있는 `4P` 를 놓쳐야 한다
python - "$F" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '|SMALLPROD|([PCH]))`'
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, '|SMALLPROD|\\\\b([PCH]))`', 1))
PY
run "연산자에 낱말 경계 붙이기"

cp "$BAK" "$F"
cmp -s "$F" "$BAK" && echo "원본 복구 확인 ok" || echo "🔴 복구 실패 — $BAK 를 보라"
