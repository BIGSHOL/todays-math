#!/usr/bin/env bash
# gemini 가 지목한 짝을 **codex 에게 하나씩 다시 묻는다.**
#
# 왜: gemini 는 깨끗한 짝에서도 11~17% 를 «결함»이라 한다(실측). 그대로 쓰면
# 멀쩡한 그림을 버린다. codex 는 깨끗한 71짝에서 지어냄 0 이었으므로 검증자로 쓴다.
#
# 접촉 시트 한 줄이 아니라 **확대한 그 짝**을 보여 준다 — 판정 조건이 더 낫다.
#
#   bash verify-flags.sh <지목목록.txt>
# 목록 형식: "<4자리> <주장 한 줄>"
set -u
SP="C:/Users/user/AppData/Local/Temp/claude/C--Creative-testautocreator/514755a6-ad9e-4e2a-882d-210afa7581c6/scratchpad/codex검수"
OUT="$SP/verify"
mkdir -p "$OUT"
LIST="$1"

while IFS= read -r line; do
  [ -z "$line" ] && continue
  id="${line%% *}"
  claim="${line#* }"
  [ -s "$OUT/$id.txt" ] && { echo "건너뜀 $id"; continue; }

  png="scripts/qa/reports/svg-compare/zoom/$id.png"
  if [ ! -f "$png" ]; then
    node scripts/qa/zoom-pair.mjs "$id" --scale=2 >/dev/null 2>&1 || { echo "확대 실패 $id"; continue; }
  fi
  [ -f "$png" ] || { echo "그림 없음 $id"; continue; }

  printf '%s\n' \
"붙인 이미지는 같은 그림 **두 장**이다: 위가 래스터(정본), 아래가 SVG(다시 그린 것)." \
"" \
"누군가 이렇게 주장했다:" \
"  「$claim」" \
"" \
"이 주장이 **참인지** 판정해라. 확대한 그림이니 꼼꼼히 견줄 수 있다." \
"" \
"🔴 주장하는 그 부분을 위·아래에서 각각 찾아 **직접 견주어라.**" \
"🔴 위(래스터)에 없는 것을 «빠졌다»고 하면 그 주장은 거짓이다." \
"🔴 선이 더 가늘거나 더 또렷한 것, 글꼴·여백·크기 차이는 결함이 아니다." \
"🔴 애매하면 «거짓»이다 — 멀쩡한 그림을 버리는 쪽이 더 나쁘다." \
"" \
"답은 **한 줄**만:" \
"  참 <위에는 무엇이 있고 아래에는 무엇이 없는지>" \
"  거짓 <왜 아닌지>" \
  | timeout 600 codex exec --skip-git-repo-check -i "$png" > "$OUT/$id.raw" 2>&1

  grep -oE '^(참|거짓) .*' "$OUT/$id.raw" | tail -1 > "$OUT/$id.txt"
  echo "$id → $(cat "$OUT/$id.txt")"
done < "$LIST"
