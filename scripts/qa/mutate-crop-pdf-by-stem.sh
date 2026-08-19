#!/usr/bin/env bash
# 기출 오려내기 가드를 **하나씩 망가뜨려** 시험이 빨개지는지 본다.
#
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18). 초록인 변이가 있으면
# 그 가드는 장식이거나, 시험 지면이 그 가드가 갈라 주는 자리를 안 만든 것이다.
set -u
A=scripts/figure/crop-pdf-by-stem.py
B=scripts/figure/crop-rpm-from-pdf.py
T=scripts/qa/test-crop-pdf-by-stem.py
BA=$(mktemp); BB=$(mktemp)
cp "$A" "$BA"; cp "$B" "$BB"
trap 'cp "$BA" "$A"; cp "$BB" "$B"; rm -f "$BA" "$BB"' EXIT

run() {  # 이름, 파일, "옛것§새것"
  cp "$BA" "$A"; cp "$BB" "$B"
  python - "$2" "$3" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
old, new = sys.argv[2].split("§")
s = p.read_text(encoding="utf-8")
if old not in s:
    print("MUT-NOT-APPLIED"); sys.exit(9)
p.write_text(s.replace(old, new, 1), encoding="utf-8")
PY
  if [ $? -eq 9 ]; then echo "  ?? $1 — 변이가 안 붙었다 (검사 자체가 못 미덥다)"; return; fi
  if python "$T" >/dev/null 2>&1; then
    echo "  ❌ $1 — 망가뜨렸는데 **초록**이다. 그 가드는 장식이다."
  else
    echo "  ✅ $1 — 빨강"
  fi
}

echo "── 변이 시험: 기출 오려내기 ──"
run "단 구분선을 안 찾는다 (단 경계가 사라진다)" "$A" \
    'divider = sorted(k * FURNITURE_ROUND for k, v in seen.items()§divider = [] and sorted(k * FURNITURE_ROUND for k, v in seen.items()'
run "단 경계를 구분선 «가운데»로 둔다 (선이 상자에 1pt 걸린다)" "$A" \
    '    if hi - lo > 4 * DIVIDER_MAX_W:
        lo, hi = lo + DIVIDER_MAX_W, hi - DIVIDER_MAX_W§    if False:
        lo, hi = lo + DIVIDER_MAX_W, hi - DIVIDER_MAX_W'
run "선택지 줄 판정을 «원문자가 있나»로 되돌린다 (그림 안의 ① 에서 끊긴다)" "$A" \
    'if not CHOICE_LINE.match(txt) or abs(r.x0 - sb.x0) > CHOICE_LEFT_PT:§if not CHOICE_MARK.search(txt):'
run "선택지 줄 띠를 안 넓힌다 (분수 꼭대기가 칸에 남는다)" "$A" \
    'if r.y1 > top and r.y0 < bot and (r.y0 < top or r.y1 > bot):§if False:'
run "「칸이 반으로 잘랐나」 검사를 끈다" "$A" \
    'def bisected(page, rect: fitz.Rect, band: tuple[float, float]) -> fitz.Rect | None:§def bisected(page, rect: fitz.Rect, band: tuple[float, float]) -> fitz.Rect | None:
    return None'
run "문항 번호 검산을 늘 통과시킨다" "$A" \
    'def page_has_question_number(doc, pi: int, q: int) -> bool:§def page_has_question_number(doc, pi: int, q: int) -> bool:
    return True'
run "두께 0인 곧은 선을 예전처럼 버린다 (전개도가 사라진다)" "$B" \
    'if thin_pt <= 0 or (r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0):§if True:'
run "단을 가로지르는 것(머리띠)을 후보에서 안 뺀다" "$B" \
    'return bound is not None and (r.x0 < bound.x0 - 0.5 or r.x1 > bound.x1 + 0.5)§return False'
run "울타리(bound)를 무시한다" "$B" \
    '    if bound is not None:
        bleed = bleed & bound§    if False:
        bleed = bleed & bound'
run "발문에서 물러서지 않는다 (삼켜 버린다)" "$B" \
    'for _ in range(LABEL_ROUNDS if avoid_stem else 0):§for _ in range(0):'
run "지면 문법을 줄이 아니라 span 으로 본다 (`[4점]` 이 안 걸린다)" "$B" \
    'if line_is_syntax:§if label_syntax is not None and label_syntax.search(raw_txt):'
echo "── 끝 (원본 복구됨) ──"
