#!/usr/bin/env bash
# 가드를 **망가뜨려 보고** 빨개지는지 확인한다. 초록이면 그 가드는 장식이다.
set -u
cd "$(dirname "$0")/../.."
F=scripts/qa/checkDeployedFigures.ts
T=src/__tests__/unit/checkDeployedFigures.test.ts
cp "$F" "$F.bak"
trap 'mv "$F.bak" "$F"' EXIT

fail=0
# ⚠️ 변이가 **적용도 안 됐는데** 초록이 나오면 그건 «가드가 장식»이 아니라
#    치환 문자열이 빗나간 것이다. 2026-08-20 에 실제로 그랬다 —
#    안쪽 python 이 따옴표 때문에 죽었는데 출력은 「🟢 초록 ← 가드가 아니다」였고,
#    하마터면 멀줦한 가드를 고치러 갈 뻔했다. 둘이 같으면 판정하지 않고 멈춘다.
run() {
  if cmp -s "$F" "$F.bak"; then
    echo "🔴 변이가 안 먹혔다 — $1  ← 치환 문자열을 고쳐라. 이건 판정이 아니다"
    fail=1; cp "$F.bak" "$F"; return
  fi
  if npx vitest run "$T" >/dev/null 2>&1; then
    echo "🟢 초록 — $1  ← 가드가 아니다"; fail=1
  else
    echo "🔴 빨강 — $1"
  fi
  cp "$F.bak" "$F"
}

# ① 바깥 주소에도 경로를 만든다 → 배포에 없다고 **잘못** 잡는다
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('if (!trimmed.startsWith(\"/\")) return null;','')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "바깥 주소(https:·data:)에도 경로를 만든다"

# ② 빠진 그림을 못 본 척한다
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('return repoPath !== null && !present.has(repoPath);','return false;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "빠진 그림을 하나도 안 센다"

# ③ 크기 0인 파일을 «있다»로 센다 (배포돼도 안 그려지는데)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('if (!Number.isFinite(size) || size <= 0) continue;','')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "크기 0인 파일을 있는 것으로 센다"

# ④ 컬럼 목록이 조용히 늘어난다 (손 목록이 새는 자리)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('  { table: \"problem\", column: \"figure_urls\" },','  { table: \"problem\", column: \"figure_urls\" },\n  { table: \"problem\", column: \"figure_svg\" },')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "그림 URL 컬럼 목록이 조용히 달라진다"

# ⑤ public/figures 만 훑는다 (2026-08-20 에 벡터 719건이 이 밖에 있었다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
s=s.replace('ref, \"--\", \"public\"', 'ref, \"--\", \"public/figures\"')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "public/figures 만 훑는다 (figures-svg 를 못 본다)"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
