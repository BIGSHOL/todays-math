#!/usr/bin/env bash
# 가드를 하나씩 망가뜨려 **빨개지는지** 본다. 초록이면 그 가드는 장식이다.
set -u
F=scripts/qa/dedupe-identical-problems.ts
T=src/__tests__/unit/dedupeIdenticalProblems.test.ts
A=scripts/qa/audit-exam-wiring.ts
AT=src/__tests__/unit/examWiringAudit.test.ts
BAK=$(mktemp); cp "$F" "$BAK"
ABAK=$(mktemp); cp "$A" "$ABAK"
pass=0; fail=0
mutate() {  # 이름, python 치환식
  cp "$BAK" "$F"
  python - "$F" <<PY
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = """$2"""
new = """$3"""
assert s.count(old) == 1, "변이 자리를 못 찾았다: $1"
io.open(p, "w", encoding="utf-8", newline="\n").write(s.replace(old, new))
PY
  if [ $? -ne 0 ]; then echo "  ?? $1 — 자리를 못 찾음"; fail=$((fail+1)); return; fi
  if npx vitest run "$T" >/dev/null 2>&1; then
    echo "  🟢 $1 — 초록이다 (가드가 장식이거나 픽스처가 그 자리를 안 가른다)"; fail=$((fail+1))
  else
    echo "  🔴 $1"; pass=$((pass+1))
  fi
}

mutate "정답 없음 검사를 뺀다" \
  'if (!bucket.every(hasAnswer))' \
  'if (false)'
mutate "그림 지목 보류를 통째로 뺀다" \
  'return "본문이 그림을 지목하는데 전원 그림이 없다 — 가르는 숫자가 그림 안일 수 있다";' \
  'return null;'
mutate "그림이 붙어 있어도 보류한다(과잉 보류)" \
  'bucket.every((row) => row.figureUrls.length === 0) &&' \
  'true &&'
mutate "남길 때 «시험지에 쓰임» 을 안 본다" \
  'row.usedInPaper > 0 ? 1 : 0,' \
  '0,'
mutate "남길 때 externalId 를 안 본다" \
  'row.externalId ? 1 : 0,' \
  '0,'
mutate "먼저 들어온 것 대신 나중 것을 남긴다" \
  '-row.createdAt.getTime(), // 먼저 들어온 것이 이긴다' \
  'row.createdAt.getTime(),'
mutate "동점일 때 순서를 안 정한다(비결정)" \
  'return a.id < b.id ? -1 : 1;' \
  'return 0;'

mutate "남길 때 exam_question 링크를 안 본다" \
  'row.examLinks > 0 ? 1 : 0,' \
  '0,'

# 배선 감사기 쪽 — 「되돌리기」가 표시만 믿지 않는지.
amutate() {
  cp "$ABAK" "$A"
  python - "$A" <<MUT
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = """$2"""
new = """$3"""
assert s.count(old) == 1, "변이 자리를 못 찾았다: $1"
io.open(p, "w", encoding="utf-8", newline="\\n").write(s.replace(old, new))
MUT
  if [ $? -ne 0 ]; then echo "  ?? $1 — 자리를 못 찾음"; fail=$((fail+1)); return; fi
  if npx vitest run "$AT" >/dev/null 2>&1; then
    echo "  🟢 $1 — 초록이다"; fail=$((fail+1))
  else
    echo "  🔴 $1"; pass=$((pass+1))
  fi
}
amutate "「되돌리기」를 표시만 보고 믿는다" \
  'declared === "되돌리기" && !REVERT_LINK.test(source)' \
  'false'
cp "$ABAK" "$A"; rm -f "$ABAK"

cp "$BAK" "$F"; rm -f "$BAK"
R=src/lib/figure/missingFigureRule.ts
RBAK=$(mktemp); cp "$R" "$RBAK"
mutate_rule() {  # 이름, python 치환식 — 판정 «정본»을 망가뜨린다
  cp "$RBAK" "$R"
  python - "$R" <<MUT
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = """$2"""
new = """$3"""
assert s.count(old) == 1, "변이 자리를 못 찾았다: $1"
io.open(p, "w", encoding="utf-8", newline="\n").write(s.replace(old, new))
MUT
  if [ $? -ne 0 ]; then echo "  ?? $1 — 자리를 못 찾음"; fail=$((fail+1)); cp "$RBAK" "$R"; return; fi
  if npx vitest run "$T" >/dev/null 2>&1; then
    echo "  🟢 $1 — 초록이다 (가드가 장식이다)"; fail=$((fail+1))
  else
    echo "  🔴 $1"; pass=$((pass+1))
  fi
  cp "$RBAK" "$R"
}

# 낱말로 되돌린다 — 2026-08-20 이전 규칙. 「식이 본문에 다 있는」 문항이 다시 걸려야 한다.
mutate_rule "그림 지목을 «낱말»로 되돌린다" \
  'classifyFigure(content) === "유실" ||' \
  '/그림|그래프|도형|상자|좌표평면/.test(content) ||'

# 라벨 도형 안전망을 뺀다
mutate_rule "라벨 도형 안전망을 뺀다" \
  'LABELED_FIGURE.test(content)' \
  'false'
echo "변이 $((pass+fail))개 — 빨강 $pass · 초록 $fail"
[ "$fail" -eq 0 ]
