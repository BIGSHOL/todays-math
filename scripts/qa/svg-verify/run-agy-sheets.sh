#!/usr/bin/env bash
# 검수 시트를 agy(안티그래비티)로 판정한다.
#   사용: bash run-agy-sheets.sh <모델> <꼬리표> <시트번호...>
MODEL="$1"; TAG="$2"; shift 2
OUT="C:/Users/user/AppData/Local/Temp/claude/C--Creative-testautocreator/514755a6-ad9e-4e2a-882d-210afa7581c6/scratchpad/codex검수"
mkdir -p "$OUT"
RULES=$(cat prompt-codex-sheet.md)
for n in "$@"; do
  p=$(printf "%04d" "$n")
  f="scripts/qa/reports/svg-compare/contact/sheet-$p.png"
  [ -f "$f" ] || { echo "없는 시트 $p" >&2; continue; }
  [ -s "$OUT/sheet-$p.$TAG.txt" ] && { echo "건너뜀 $p"; continue; }
  timeout 900 agy --dangerously-skip-permissions --disable-slash-commands \
    --model "$MODEL" --add-dir "$PWD" \
    -p "먼저 Read 도구로 이미지 \`$f\` 를 열어서 봐라. 그 이미지가 아래에서 말하는 «검수 시트»다.
파일을 만들거나 고치지 마라. 보고서도 쓰지 마라. 답만 말한다.

$RULES" > "$OUT/sheet-$p.$TAG.raw" 2>&1
  grep -E '^[0-9]{4} (OK|결함)' "$OUT/sheet-$p.$TAG.raw" | sort -u > "$OUT/sheet-$p.$TAG.txt"
  echo "$p → $(wc -l < "$OUT/sheet-$p.$TAG.txt")줄"
done
