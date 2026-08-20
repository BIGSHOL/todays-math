#!/usr/bin/env bash
# 바꿔치기 고르기의 가드를 하나씩 망가뜨려 **빨개지는지** 확인한다.
# 초록인 가드는 가드가 아니라 장식이다 (CLAUDE.md 2026-08-18).
set -u
F=scripts/qa/swap-figure-files.ts
B=$(mktemp); cp "$F" "$B"
fail=0
mutate() {
  cp "$B" "$F"
  python - "$1" "$2" <<'PY'
import io,sys
p="scripts/qa/swap-figure-files.ts"
s=io.open(p,encoding="utf-8").read()
old,new=sys.argv[1],sys.argv[2]
assert s.count(old)==1, f"{old!r} 이 {s.count(old)}번 나온다"
io.open(p,"w",encoding="utf-8",newline="\n").write(s.replace(old,new,1))
PY
  if npx vitest run src/__tests__/unit/swapFigureFiles.test.ts >/dev/null 2>&1; then
    echo "  🔴 초록  $3  ← 이 가드는 아무것도 안 지킨다"; fail=1
  else
    echo "  ✅ 빨강  $3"
  fi
}
echo "변이 시험 — 가드를 끄면 빨개져야 한다"
mutate 'if (r.verdict !== "바꾼다") {' 'if (false) {'                     '가로가 늘었나'
mutate 'if (r.extChanged) {'          'if (false) {'                     '확장자가 달라지나'
mutate 'if (r.sameBytes) {'           'if (false) {'                     '바이트가 같나'
mutate 'if (!ids || ids.length === 0) {' 'if (false) {'                  '고아 파일인가'
mutate 'if (widthChanged.has(url)) {' 'if (false) {'                     '지면 폭이 달라지나'
cp "$B" "$F"; rm -f "$B"
echo "원본 복구 완료"
exit $fail
