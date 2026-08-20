#!/usr/bin/env bash
# 검수 시트를 codex 로 한 장씩 판정한다. 인자: 시트 번호들
OUT="C:/Users/user/AppData/Local/Temp/claude/C--Creative-testautocreator/514755a6-ad9e-4e2a-882d-210afa7581c6/scratchpad/codex검수"
mkdir -p "$OUT"
for n in "$@"; do
  p=$(printf "%04d" "$n")
  f="scripts/qa/reports/svg-compare/contact/sheet-$p.png"
  [ -f "$f" ] || { echo "없는 시트 $p" >&2; continue; }
  [ -s "$OUT/sheet-$p.txt" ] && { echo "건너뜀 $p (이미 있음)"; continue; }
  cat prompt-codex-sheet.md | timeout 600 codex exec --skip-git-repo-check -i "$f" \
    > "$OUT/sheet-$p.raw" 2>&1
  # codex 는 머리말·훅 로그를 찍는다. 판정 줄만 골라낸다.
  grep -E '^[0-9]{4} (OK|결함)' "$OUT/sheet-$p.raw" | sort -u > "$OUT/sheet-$p.txt"
  echo "$p → $(wc -l < "$OUT/sheet-$p.txt")줄"
done
