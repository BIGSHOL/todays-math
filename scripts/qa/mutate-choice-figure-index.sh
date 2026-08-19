#!/usr/bin/env bash
# `choiceFigureIndex` 규약과 적재 가드를 하나씩 망가뜨려 테스트가 **정말** 빨개지는지 본다.
#
# 여기서 지키는 것은 하나다 — **모를 때 «모른다» 로 받는가.**
# 빈 배열이 「아무 그림이나 ①에 붙여도 된다」로 미끄러지면 지금보다 나쁘다.
# 그 미끄러짐을 실제로 만들어 보고, 테스트가 잡는지 확인한다.
set -u
RULE=src/lib/problem/choiceFigureIndex.ts
APPLY=scripts/qa/apply-choice-figure-index.ts
DISCARD=scripts/qa/apply-choice-figure-discard.ts
TESTS="src/__tests__/unit/choiceFigureIndex.test.ts src/__tests__/unit/applyChoiceFigureIndex.test.ts src/__tests__/unit/applyChoiceFigureDiscard.test.ts"
R_ORIG=$(mktemp); A_ORIG=$(mktemp); D_ORIG=$(mktemp)
# 🔴 못 찾은 패턴·초록 변이를 **센다**. 세지 않으면 「21개 전부 빨강」이 거짓말이 된다
# — 실제로 둘이 조용히 건너뛰어졌고 스크립트는 종료 코드 0 을 냈다(적대적 리뷰 ⑤).
MISSING=0; GREEN=0
# ⚠️ 고정 이름을 쓰면 이 스크립트의 출력을 같은 파일로 리다이렉트했을 때 서로 덮어쓴다.
VITEST_LOG=$(mktemp)
cp "$RULE" "$R_ORIG"; cp "$APPLY" "$A_ORIG"; cp "$DISCARD" "$D_ORIG"

restore() { cp "$R_ORIG" "$RULE"; cp "$A_ORIG" "$APPLY"; cp "$D_ORIG" "$DISCARD"; }

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  restore
  python - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
if a not in s:
    sys.stderr.write('PATTERN NOT FOUND\n'); sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then
    echo "🟠 못 찾음  $name  <-- 변이가 **돌지 않았다**. 패턴을 고쳐라"
    MISSING=$((MISSING + 1)); return
  fi
  if npx vitest run $TESTS >"$VITEST_LOG" 2>&1; then
    echo "🟢 초록  $name  <-- 가드가 아니다"
    GREEN=$((GREEN + 1))
  else
    echo "🔴 빨강  $name"
  fi
}

# ── 규약 (src/lib/problem/choiceFigureIndex.ts) ──────────────────────────
mutate "빈 배열을 «안다» 로 받는다 (미끄러짐 그 자체)" "$RULE" \
  'if (!flat || flat.length === 0) return { ok: false, reason: "모른다" };' \
  'if (!flat || flat.length === 0) return { ok: true, reason: "" };'
mutate "길이 불일치를 봐준다" "$RULE" \
  'if (flat.length !== figureCount)' \
  'if (false)'
mutate "길이가 짧아도 앞부분만 쓴다 (반쪽 허용)" "$RULE" \
  'if (flat.length !== figureCount)' \
  'if (flat.length > figureCount)'
mutate "0 이 아닌 번호의 중복을 봐준다" "$RULE" \
  '    if (used.has(value))' \
  '    if (false)'
mutate "발문(0)도 중복 검사에 넣는다 (발문 여럿을 막아 버린다)" "$RULE" \
  '    if (value === 0) continue; // 발문 그림은 여럿일 수 있다' \
  '    if (false) continue;'
mutate "범위 검사를 없앤다" "$RULE" \
  'if (!Number.isInteger(value) || value < 0 || value > MAX_CHOICE_NUMBER)' \
  'if (false)'
mutate "상한 10 -> 1000" "$RULE" \
  'export const MAX_CHOICE_NUMBER = 10;' \
  'export const MAX_CHOICE_NUMBER = 1000;'
mutate "모를 때 null 대신 ①부터 순서대로 붙인다 (그럴듯한 거짓말)" "$RULE" \
  '  if (!checkChoiceFigureIndex(figureCount, flat).ok) return unknown();' \
  '  if (!checkChoiceFigureIndex(figureCount, flat).ok)\n    return Array.from({ length: figureCount }, (_, i) => ({ kind: "choice", number: i + 1 }) as const);'

# ── 적재 가드 (scripts/qa/apply-choice-figure-index.ts) ──────────────────
mutate "«자동» 이 아닌 것도 쓴다" "$APPLY" \
  '  if (pair.verdict !== "자동")' \
  '  if (false)'
mutate "멱등을 없앤다 (이미 있는 값을 덮는다)" "$APPLY" \
  '  if (now.choiceFigureIndex.length > 0)' \
  '  if (false)'
mutate "그림 목록이 바뀌어도 쓴다 (한 칸씩 밀린 짝)" "$APPLY" \
  '  if (!same)' \
  '  if (false)'
mutate "그림 목록을 길이만 본다 (경로 바뀜을 못 잡는다)" "$APPLY" \
  '    seen.every((u, i) => u === now.figureUrls[i]);' \
  '    true;'
mutate "쓰기 전 규약 검산을 건너뛴다" "$APPLY" \
  '  if (!check.ok) return { ok: false, reason: `규약 위반: ${check.reason}` };' \
  '  void check;'
# ⚠️ `planRow` 의 `before: now.choiceFigureIndex` 를 `[]` 로 바꾸는 변이는 **초록이다.**
#    빼먹은 가드가 아니라 **구조적으로 관측되지 않는** 자리다 — 멱등 가드가 값이 있는
#    행을 이미 걷어내므로 계획 시점의 `before` 는 항상 빈 배열이다. 그래서 그 변이는
#    빼고, 값이 실제로 쓰이는 **되돌리기 쪽**을 대신 망가뜨린다(아래 둘).
mutate "되돌릴 값을 원장의 before 대신 빈 배열로 박는다" "$APPLY"   'return { restore: true, to: row.before };'   'return { restore: true, to: [] };'
mutate "되돌리기가 남의 변경을 덮는다" "$APPLY"   '  if (!same)
    return {
      restore: false,
      reason: "우리가 쓴 값이 아니다 — 남의 변경을 덮지 않는다",
    };
'   ''


# ── 출제 제외 가드 (scripts/qa/apply-choice-figure-discard.ts) ───────────
mutate "무리를 안 거르고 «불가» 를 전부 뺀다 (43 -> 433 그 결함)" "$DISCARD"   '  if (!isChoiceFigure)'   '  if (false)'
mutate "«사람확인» 도 뺀다" "$DISCARD"   '  if (pair.verdict !== "불가")'   '  if (false)'
mutate "그림 유실 원장과 겹쳐도 뺀다" "$DISCARD"   '  if (alreadyFigureLocked)'   '  if (false)'
mutate "이미 빠진 행도 다시 뺀다 (멱등 깨기)" "$DISCARD"   '  if (!row.directUseAllowed)
    return { lock: false, reason: "이미 빠져 있다 (멱등)" };
'   ''
mutate "되돌리기가 남의 변경을 덮는다" "$DISCARD"   '  if (now.directUseAllowed !== false)'   '  if (false)'
mutate "되돌릴 값을 true 로 박는다" "$DISCARD"   '  return { restore: true, to: locked.directUseAllowed };'   '  return { restore: true, to: true };'
mutate "🔴 객관식이 아닌 문항도 뺀다 (43 안에 서술형 10건이 섞인 그 결함)" "$DISCARD"   '  if (!isChoiceAnswer(row.answer))'   '  if (false)'
mutate "🔴 정답 모양 대신 아무 글자나 객관식으로 본다" "$DISCARD"   'return /^\s*[①-⑩1-5](\s*[,·]\s*[①-⑩1-5])*\s*$/.test((answer ?? "").trim());'   'return (answer ?? "").length > 0;'
mutate "🔴 그림이 하나도 없는 행도 뺀다" "$DISCARD"   '  if ((row.figureUrls?.length ?? 0) === 0)'   '  if (false)'

restore
rm -f "$R_ORIG" "$A_ORIG" "$D_ORIG" "$VITEST_LOG"
echo "원복 완료"
if [ "$MISSING" -ne 0 ] || [ "$GREEN" -ne 0 ]; then
  echo "🔴 변이 시험 실패 — 못 찾음 ${MISSING}개 · 초록 ${GREEN}개"
  echo "   (못 찾은 변이는 «돌지 않은» 것이다. 「전부 빨강」이라고 적으면 거짓말이 된다)"
  exit 1
fi
echo "✅ 변이 전부 빨강"
