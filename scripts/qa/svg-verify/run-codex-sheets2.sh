#!/usr/bin/env bash
# 두 번째 시선. 인자: 시트 번호들
OUT="C:/Users/user/AppData/Local/Temp/claude/C--Creative-testautocreator/514755a6-ad9e-4e2a-882d-210afa7581c6/scratchpad/codex검수"
mkdir -p "$OUT"
for n in "$@"; do
  p=$(printf "%04d" "$n")
  f="scripts/qa/reports/svg-compare/contact/sheet-$p.png"
  [ -f "$f" ] || { echo "없는 시트 $p" >&2; continue; }
  [ -s "$OUT/sheet-$p.b.txt" ] && { echo "건너뜀 $p"; continue; }
  cat prompt-codex-sheet2.md | timeout 900 codex exec --skip-git-repo-check -i "$f" \
    > "$OUT/sheet-$p.b.raw" 2>&1
  grep -E '^[0-9]{4} (OK|결함)' "$OUT/sheet-$p.b.raw" | sort -u > "$OUT/sheet-$p.b.txt"
  echo "$p → $(wc -l < "$OUT/sheet-$p.b.txt")줄"
done
