#!/usr/bin/env bash
# 회수 판정기의 열쇠·문턱을 **하나씩 망가뜨려** 회귀 가드가 실제로 빨개지는지 본다.
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18).
#
#   bash scripts/qa/mutate-hwp-rescue-rules.sh
#
# ⚠️ **HWP COM 을 쓰지 않는다.** 이미 뽑아 둔 픽스처만 본다(vitest 만 돈다).
#
# 초록이 나오면 둘 중 하나다 — 그 검사가 아무것도 안 가르거나(지워라),
# 픽스처가 경계를 안 가르거나(픽스처를 고쳐라).
set -u
RULES=scripts/qa/hwpRescueRules.ts
JUDGE=scripts/qa/hwpJudgeRules.ts
R2=scripts/qa/choiceRepairRules.ts
TEST=src/__tests__/unit/hwpRescueRules.test.ts

# ⚠️ 백업은 **저장소 밖** 임시 폴더에 둔다. 처음엔 `foo.ts.bak` 를 옆에 두고
#    `BASE=$(tests)` 로 결과를 받았는데, 명령 치환이 만드는 서브셸에서 EXIT 트랩이
#    돌아 백업을 **원본 위로 되돌리고 지워 버렸다.** 그 뒤로는 복원이 조용히 실패해
#    변이가 **차곡차곡 쌓였고**, 「21개 전부 빨강」은 첫 변이 하나 때문이었다.
#    실제로 소스 세 개가 변이된 채 남았다 — 변이 시험이 규칙을 망가뜨린 것이다.
#    그래서 (ㄱ) 백업을 트리 밖에 두고 (ㄴ) 명령 치환을 안 쓰고
#    (ㄷ) 매 변이 전에 **복원이 실제로 됐는지 확인**하고 (ㄹ) 끝나고 원본과 대조한다.
BAK=$(mktemp -d)
cp "$RULES" "$BAK/rules"; cp "$JUDGE" "$BAK/judge"; cp "$R2" "$BAK/r2"
restore() { cp "$BAK/rules" "$RULES"; cp "$BAK/judge" "$JUDGE"; cp "$BAK/r2" "$R2"; }
trap 'restore; rm -rf "$BAK"' EXIT

BASE=FAIL
if npx vitest run "$TEST" >/dev/null 2>&1; then BASE=PASS; fi
echo "원본: $BASE"
if [ "$BASE" != "PASS" ]; then
  echo "원본이 이미 빨강이다 — 변이 시험이 의미가 없다. 먼저 고칠 것."
  exit 1
fi
echo

red=0; green=0
mutate_file() {
  restore
  # 복원이 실제로 됐는지 **매번** 확인한다. 안 하면 변이가 쌓여도 아무도 모른다.
  if ! cmp -s "$BAK/rules" "$RULES" || ! cmp -s "$BAK/judge" "$JUDGE" || ! cmp -s "$BAK/r2" "$R2"; then
    echo "🛑 복원 실패 — 변이가 쌓인다. 중단한다."; exit 1
  fi
  python - "$1" "$2" "$3" <<'PY'
import io,sys,os
p,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8",newline="").read()
assert old in s, "변이 대상을 못 찾았다: " + old
out=s.replace(old,new,1)
tmp=p+".tmp"
f=io.open(tmp,"w",encoding="utf-8",newline=""); f.write(out); f.close()
os.replace(tmp,p)
PY
  local t=FAIL
  if npx vitest run "$TEST" >/dev/null 2>&1; then t=PASS; fi
  if [ "$t" = "$BASE" ]; then green=$((green+1)); echo "🟢 안 바뀜   $4"
  else red=$((red+1)); echo "🔴 빨강      $4"; fi
}
mutate() { mutate_file "$RULES" "$1" "$2" "$3"; }

# ── 짝 확인 — 축과 문턱 ───────────────────────────────────────────────────
mutate "  const contain = containment(a, b);" "  const contain = dice(a, b);" "🔴 짝 확인의 축을 포함도 → Dice 로 (크기 다른 행이 «다른 문제»가 된다)"
mutate "    mismatched: comparable && contain < PAIR_MIN_CONTAIN," "    mismatched: false," "짝 확인을 끈다"
mutate "    mismatched: comparable && contain < PAIR_MIN_CONTAIN," "    mismatched: contain < PAIR_MIN_CONTAIN," "«양쪽이 넉넉할 때만» 가드를 끈다 (손상된 DB 가 «다른 문제»가 된다)"
mutate "const PAIR_MIN_CONTAIN = 0.3;" "const PAIR_MIN_CONTAIN = 0.02;" "짝 문턱을 0.3 → 0.02 로 (진짜 다른 문제를 통과시킨다)"
mutate "const PAIR_MIN_KO = 15;" "const PAIR_MIN_KO = 1;" "«견줄 수 없다» 판단을 없앤다"

# ── 보기가 가짜인가 — 열쇠 ────────────────────────────────────────────────
mutate "const CIRCLED_RUN_MIN = 3;" "const CIRCLED_RUN_MIN = 2;" "🔴 런 문턱을 3 → 2 로 (「①과 ②의…」 참조가 가짜가 된다)"
mutate "    (c) => maxCircledRun(c) >= CIRCLED_RUN_MIN," "    (c) => false," "«보기가 가짜» 검사를 끈다"
mutate "    run = i === prev + 1 ? run + 1 : 1;" "    run = run + 1;" "런을 «순서 무관»으로 (역순도 런으로 센다)"

# ── 회복의 정의 ───────────────────────────────────────────────────────────
mutate "  else if (best.verdict === \"정상\") rescue = \"완전회복\";" "  else if (!isFatal(best.verdict)) rescue = \"완전회복\";" "🔴 회복을 «치명 아님»으로 (보기를 잃은 것이 회복이 된다)"
mutate "  if (pair.mismatched) rescue = \"문항불일치\";" "  if (false) rescue = \"문항불일치\";" "🔴 짝 확인을 판정에서 뺀다"
mutate "  else if (hwpFilled >= CHOICE_BLOCK_MIN) rescue = \"부분\";" "  else if ((hwp.choices ?? []).length >= CHOICE_BLOCK_MIN) rescue = \"부분\";" "🔴 «칸에 글자가 있나»를 «마커가 있나»로 (그림 보기가 «부분»이 된다)"
mutate "  else if (hwpFilled >= CHOICE_BLOCK_MIN) rescue = \"부분\";" "  else if (Math.max(slots.HWP, slots[\"HWP+R2\"]) >= CHOICE_BLOCK_MIN) rescue = \"부분\";" "«칸에 글자가 있나»를 파서 칸 수로 (발문 조각이 보기가 된다)"
mutate "const CHOICE_BLOCK_MIN = 4;" "const CHOICE_BLOCK_MIN = 1;" "«보기 한 벌»의 하한을 4 → 1 로"

# ── 팔 ────────────────────────────────────────────────────────────────────
mutate "  const hR2 = judge(splitInlineChoiceMarkers(hwpContent));" "  const hR2 = judge(hwpContent);" "🔴 R2 를 HWP 쪽에 안 건다 (줄 중간 부류가 안 살아난다)"
mutate "  const dbR2 = judge(splitInlineChoiceMarkers(input.content));" "  const dbR2 = judge(input.content);" "R2 를 DB 쪽에 안 건다"
mutate "  if (ra !== rb) return ra > rb ? a : b;" "  return a;" "«나은 팔 고르기»를 끈다 (늘 HWP 팔만 본다)"
mutate_file "$JUDGE" "  const stem = stripWatermark((q.stem ?? \"\").trim());" "  const stem = \"\";" "본문 짓기에서 발문을 뺀다"
mutate_file "$R2" "    } else if (circled >= 0 && (num === expected || num === 1)) {" "    } else if (false) {" "R2 의 줄 중간 절단을 끈다"

# ── 근거 ──────────────────────────────────────────────────────────────────
mutate "    정답일치: same," "    정답일치: true," "정답 근거를 늘 참으로"
mutate "      score != null && hwp.score != null && Math.abs(score - hwp.score) < 0.01," "      false," "배점 근거를 늘 거짓으로"

# ── 부류 ──────────────────────────────────────────────────────────────────
mutate "    case \"마커는 있으나 본문이 비었다\":
      return \"그림\";" "      return \"본문\";" "«본문이 빔»을 그림 부류에서 뺀다"

echo
echo "변이 $((red+green))개 중 빨강 $red · 초록 $green"

# 끝나고 **원본과 같은지 확인**한다. 다르면 변이가 남은 것이다 — 조용히 넘어가지 않는다.
restore
if cmp -s "$BAK/rules" "$RULES" && cmp -s "$BAK/judge" "$JUDGE" && cmp -s "$BAK/r2" "$R2"; then
  echo "복원 확인: 소스 3개 모두 원본과 같다."
else
  echo "🛑 복원이 안 됐다 — 소스에 변이가 남아 있다."; exit 1
fi
