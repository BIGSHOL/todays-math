#!/usr/bin/env bash
# 변이 하네스가 **하나도** 안 돌고 그 상태가 N초 이어질 때까지 기다린다.
#
#   bash scripts/qa/wait-mutations-quiet.sh [조용할초=120]
#
# 왜 「조용할 초」가 필요한가 — 표지가 **한 번 걷혔다**가 「이제 안전하다」가 아니다.
# 하네스를 연달아 돌리면 두 회차 **사이의 틈**에 뛰어들게 되고, 그러면 다음 회차가
# 망가뜨린 상태를 「최종 결과」로 재게 된다. 2026-08-22 에 실제로 그 틈에 걸렸다.
#
# ⚠️ 처음 판은 이렇게 썼다가 **거꾸로 걸렸다**:
#
#     if ls A B C >/dev/null 2>&1; then 도는중; else 조용함; fi
#
# `ls` 는 인자 **하나라도 없으면** 실패한다. A 가 없고 B 가 **있어도** 실패 → 「조용함」.
# 그래서 표지가 떠 있는데 「120초 조용했다」고 알렸다. 이 스크립트가 오늘 잡아 온
# 「가드가 거꾸로 걸린다」와 **같은 부류**다 — 그래서 아래에 자체 눈금을 붙였다.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$ROOT")"
cd "$ROOT"

# 표지가 있을 수 있는 자리. 새 하네스가 생기면 여기에 더한다.
markers() {
  # shellcheck disable=SC2231
  for f in MUTATION-IN-PROGRESS.*; do [ -e "$f" ] && echo "$f"; done
  [ -e scripts/figure/MUTATION-IN-PROGRESS.txt ] && echo scripts/figure/MUTATION-IN-PROGRESS.txt
  [ -e scripts/qa/.mutation-in-progress ] && echo scripts/qa/.mutation-in-progress
  return 0
}

if [ "${1:-}" = "--selftest" ]; then
  # 눈금 — **있는 것을 찾는가**(양성)와 **없는 것을 지어내지 않는가**(음성) 둘 다 본다.
  # 양성만 대면 「0건」이 「깨끗」인지 「못 셈」인지 갈리지 않는다.
  fail=0
  before="$(markers | wc -l)"
  touch MUTATION-IN-PROGRESS.__selftest__.txt
  after="$(markers | wc -l)"
  rm -f MUTATION-IN-PROGRESS.__selftest__.txt
  gone="$(markers | wc -l)"
  [ "$after" -eq $((before + 1)) ] && echo "  ✅ 뿌리 표지를 찾는다" || { echo "  ❌ 뿌리 표지를 못 찾는다 ($before → $after)"; fail=1; }

  mkdir -p scripts/figure
  touch scripts/figure/MUTATION-IN-PROGRESS.txt.__selftest__
  mv scripts/figure/MUTATION-IN-PROGRESS.txt.__selftest__ /tmp/__mk 2>/dev/null || true
  if [ ! -e scripts/figure/MUTATION-IN-PROGRESS.txt ]; then
    touch scripts/figure/MUTATION-IN-PROGRESS.txt
    n="$(markers | wc -l)"
    rm -f scripts/figure/MUTATION-IN-PROGRESS.txt
    [ "$n" -eq $((gone + 1)) ] && echo "  ✅ 그림 세션 표지를 찾는다" || { echo "  ❌ 그림 세션 표지를 못 찾는다"; fail=1; }
  else
    echo "  ⏭ 그림 세션 표지가 지금 실제로 떠 있어 이 눈금은 건너뛴다"
  fi

  [ "$gone" -eq "$before" ] && echo "  ✅ 지운 표지를 지어내지 않는다" || { echo "  ❌ 없는 표지를 센다"; fail=1; }
  echo
  [ "$fail" -eq 0 ] && echo "✅ 눈금 통과" || echo "❌ 눈금 실패 — 이 대기를 믿지 마라"
  exit "$fail"
fi

NEED="${1:-120}"
quiet=0
while [ "$quiet" -lt "$NEED" ]; do
  if [ -n "$(markers)" ]; then
    quiet=0
  else
    quiet=$((quiet + 5))
  fi
  sleep 5
done
echo "✅ 변이 표지가 ${NEED}초 이상 하나도 없음 — $(date '+%H:%M:%S')"
