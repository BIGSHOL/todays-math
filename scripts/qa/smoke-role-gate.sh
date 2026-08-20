#!/usr/bin/env bash
# 역할 게이트를 **실물로** 확인한다 — 진짜 로그인, 진짜 미들웨어.
#
# 🔴 왜 있나: 미들웨어 단위 테스트는 `getToken` 을 **모킹한다.** 그래서
#    「getToken 이 실제로 우리 쿠키를 찾는가」는 그 테스트가 구조적으로 못 본다.
#    이 저장소가 이미 겪은 자리다(2026-08-19: AI 를 전부 모킹해 놓고 실물에서 죽었다).
#
#   bash scripts/qa/smoke-role-gate.sh <포트> <이메일> <비밀번호>
set -u
PORT="${1:-3210}"
EMAIL="${2:?이메일}"
PASS="${3:?비밀번호}"
BASE="http://localhost:$PORT"
JAR="$(mktemp -t rolegate.XXXXXX)"
fail=0

echo "서버를 기다린다…"
for _ in $(seq 1 180); do
  curl -s -o /dev/null --max-time 3 "$BASE/api/auth/csrf" && break
  sleep 2
done
curl -s -o /dev/null --max-time 5 "$BASE/api/auth/csrf" || { echo "🔴 서버가 안 뜬다"; exit 1; }

CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
[ -n "$CSRF" ] || { echo "🔴 csrf 토큰을 못 받았다"; exit 1; }

curl -s -o /dev/null -b "$JAR" -c "$JAR" \
  -d "csrfToken=$CSRF" -d "email=$EMAIL" -d "password=$PASS" -d "redirect=false" \
  "$BASE/api/auth/callback/credentials"

SESSION=$(curl -s -b "$JAR" "$BASE/api/auth/session")
case "$SESSION" in
  *"$EMAIL"*) echo "로그인 됐다 ✓";;
  *) echo "🔴 로그인 실패 — $SESSION"; exit 1;;
esac
case "$SESSION" in
  *'"role":"reviewer"'*) echo "세션에 역할이 실렸다 ✓";;
  *) echo "🔴 세션에 role 이 없다 — $SESSION"; fail=1;;
esac

check() { # <기대코드> <메서드> <경로> <설명>
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X "$2" "$BASE$3")
  if [ "$code" = "$1" ]; then
    echo "  ✓ $2 $3 → $code  ($4)"
  else
    echo "  🔴 $2 $3 → $code, 기대 $1  ($4)"
    fail=1
  fi
}

echo "검수 계정이 **못 하는** 것:"
check 403 POST /api/tests/generate "출제"
check 403 GET  /api/tests          "시험지 목록"
check 403 GET  /api/classes        "반 관리"
check 403 POST /api/problems/generate "AI 생성"
check 307 GET  /classes            "반 화면 → /review 로 되돌림"
check 307 GET  /                   "메인 화면 → /review 로 되돌림"

echo "검수 계정이 **하는** 것:"
check 200 GET /review        "검수 화면"
check 200 GET /api/problems  "문제은행"
check 200 GET /api/units     "단원"
check 200 GET "/api/review/queue?key=pending&limit=3" "대기열"

rm -f "$JAR"
if [ "$fail" = 0 ]; then echo "역할 게이트 실물 확인 통과"; else echo "🔴 실패가 있다"; exit 1; fi
