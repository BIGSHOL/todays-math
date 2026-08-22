#!/usr/bin/env bash
# 새로 넣은 두 가드를 **일부러 망가뜨려** 빨개지는지 본다.
#
#   ⑴ 원장님 ⑤ — 정삼각형 문항 그림에 등변 표시가 없다
#   ⑵ 원장님 ④·⑨ — 막대그래프 소재가 소단원마다·씨앗마다 갈린다
#
# 순서가 중요하다 (CLAUDE.md 2026-08-21):
#   ① 파일이 바뀌었나  ② **산출물이 바뀌었나**  ③ 그제서야 시험이 빨개지나
# ② 를 건너뛰면 「가드가 아니다」가 거짓말이 되어 **멀쩡한 가드를 고치러 간다**.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TARGET="src/lib/elementary/g4.ts"
BAK="$(mktemp)"
# 표본기는 **저장소 안**에 두어야 한다 — 상대 import 가 저장소 밖에서는 안 풀린다.
PROBE="scripts/qa/_mutprobe.ts"
cp "$TARGET" "$BAK"

cat > "$PROBE" <<'PROBE_EOF'
import { elementaryUnits, generateElementaryProblem } from "../../src/lib/elementary/generate";
const tri = elementaryUnits().find((u) => u.section.includes("변의 길이에 따라 분류"))!;
const bars = elementaryUnits().filter((u) => u.chapter.includes("막대그래프"));
const out: string[] = [];
out.push(JSON.stringify(generateElementaryProblem(tri, 20260821).figureSpec));
for (const u of bars) {
  for (const s of [20260821, 7, 1234, 99991, 555, 4242]) {
    const spec = generateElementaryProblem(u, s).figureSpec as { values?: { label: string }[] };
    out.push((spec?.values ?? []).map((v) => v.label).join(","));
  }
}
console.log(out.join("\n"));
PROBE_EOF

# ⚠️ 이 하네스는 **남의 담당 파일을 제자리에서** 변이시켰다가 되돌린다.
# 다중 세션 워크트리에서 그 사이 그 파일을 읽은 세션은 「누가 내 파일을 고쳤다」로 읽는다 —
# 2026-08-22 에 두 번 났다(elem-g4 가 주입된 `marks: true` 를, elem-figures 가
# 점선 없는 중간 상태를 봤다). 사람 기억에 기대지 말고 **표시를 남긴다.**
#
# 이상한 것을 본 세션은 이 파일부터 보면 된다:
#     ls MUTATION-IN-PROGRESS.*  &&  cat MUTATION-IN-PROGRESS.*
#
# 표지는 **저장소 뿌리**에 둔다 — `scripts/qa/` 와 `scripts/figure/` 로 갈리면
# 상대는 자기 쪽만 본다. 이름에 하네스를 붙여 둘이 동시에 돌아도 안 덮어쓴다:
#     ls MUTATION-IN-PROGRESS.*     ← 도는 것 전부가 한 줄에 보인다
MARK="MUTATION-IN-PROGRESS.elem-engine-guards.txt"
printf '%s\n' \
  "변이 진행 중 — 이 파일의 내용은 **일시적으로 조작된 것**입니다." \
  "  대상 : $TARGET" \
  "  주인 : claude-b3 (team-lead)" \
  "  PID  : $$" \
  "  시작 : $(date '+%Y-%m-%d %H:%M:%S')" \
  "" \
  "끝나면 원본으로 복구되고 이 표시도 지워집니다. 그때까지:" \
  "  · 그 파일의 코드를 읽고 결함을 판정하지 마십시오" \
  "  · 그 파일이 관련된 시험의 빨강을 보고하지 마십시오" \
  "  · 전체 관문 수치를 적지 마십시오" \
  "" \
  "⚠️ 하네스가 비정상 종료하면 이 표시만 남습니다(그러면 아무도 안 도는데 다들 기다린다)." \
  "   PID 로 확인하십시오 —  kill -0 $$ 2>/dev/null && echo 살아있음 || echo '죽음(표시를 지우고 git diff 로 복구 확인)'" \
  "   프로세스를 «이름으로» 세지 마십시오. elem-g4 가 \`ps -ef | grep '…\\.sh\$'\` 의 \$ 앵커 때문에" \
  "   0을 얻고 「죽었다」고 판단해 **도는 하네스 밑에서 파일을 고칠 뻔했습니다**(2026-08-22)." \
  > "$MARK"

restore() { cp "$BAK" "$TARGET"; }
cleanup() { restore; rm -f "$PROBE" "$MARK"; }
trap cleanup EXIT

echo "── 기준 산출물 ─────────────────────────────"
BASE="$(npx tsx "$PROBE" 2>&1)" || { echo "기준 산출물을 못 냈다 — 멈춘다"; exit 1; }
echo "$BASE" | head -3

run_mutation() {
  local name="$1" py="$2"
  echo
  echo "══ 변이: $name"
  restore
  MUT_PY="$py" python - <<'PY'
import os, io, re
path = "src/lib/elementary/g4.ts"
src = io.open(path, encoding="utf-8").read()
exec(os.environ["MUT_PY"])
io.open(path, "w", encoding="utf-8", newline="").write(src)
PY
  if cmp -s "$BAK" "$TARGET"; then
    echo "  ⛔ 파일이 안 바뀌었다 — **판정하지 않는다**(치환이 빗나갔다)"
    return
  fi
  local now
  now="$(npx tsx "$PROBE" 2>&1)"
  if [ "$now" = "$BASE" ]; then
    echo "  ⛔ 파일은 바뀌었는데 **산출물이 그대로다** — 판정하지 않는다(뜻이 안 바뀐 변이)"
    return
  fi
  if npx vitest run src/__tests__/unit/elementaryEngine.test.ts >/dev/null 2>&1; then
    echo "  🟢 초록 ← **가드가 아니다**"
  else
    echo "  🔴 빨강 ← 가드가 맞다"
  fi
}

run_mutation "정삼각형 그림에 등변 표시를 켠다 (원장님 ⑤ 재발)" \
  'src = src.replace("{ shape: \"eqTri\", label: \"가\" },", "{ shape: \"eqTri\", label: \"가\", marks: true },", 1)'

run_mutation "막대그래프 소재를 한 무리로 고정 (소단원마다 같아진다)" \
  'src = src.replace("BAR_FAMILIES[unit.orderIndex % BAR_FAMILIES.length]!", "BAR_FAMILIES[0]!", 1)'

run_mutation "막대그래프가 씨앗을 무시한다 (문제마다 똑같아진다)" \
  'src = src.replace("const theme = pick(rng, family);", "const theme = family[0]!;", 1)'

# ⑤ 의 **뒷면** — 곁들이가 정답과 구별이 안 되면 그림으로 답을 낼 수 없다.
#
# ⚠️ 처음엔 「곁들이에 `isoTri` 되돌리기」로 변이시켰다. 그때 isoTri 는 변 비 **1.118** 이라
# 정삼각형(1.000)과 구별이 안 됐다. 그런데 그림 세션이 `ISO_TRI_BASE = 0.58` 로 밑변을 좁혀
# **1.795** 가 됐다 — 이제 한눈에 갈리므로 **그 변이는 더는 결함이 아니다**(초록이 맞다).
# elem-g4 가 잡아 줬다. **변이는 «영원히 결함인 것»이라야 낡지 않는다.**
#
# 그래서 곁들이를 `eqTri` 로 바꾼다 — 곁들이가 정답과 **같은 도형**이면 정답이 둘이 되므로
# 그림 엔진이 무엇을 바꾸든 결함이다.
#
# ⚠️ 치환은 **목록 내용에 기대지 않는다.** 처음엔 `["rightTri", "wideTri"]` 를 글자 그대로
# 찾았는데, 곁들이에 `isoTri` 가 되돌아오자 **빗나갔다**(하네스가 「파일이 안 바뀌었다」로
# 멈춰 거짓 초록은 안 났지만, 그 변이는 아무것도 시험하지 않게 된다).
# 목록이 어떻게 바뀌든 **통째로** 갈아 끼운다.
run_mutation "정삼각형 곁들이를 eqTri 로 채운다 (정답이 둘이 된다)" \
  'src = re.sub(r"const TRI_DISTRACTORS = \[[^\]]*\]", "const TRI_DISTRACTORS = [\"eqTri\"]", src, count=1)'

echo
restore
echo "원상 복구 완료 — $(cmp -s "$BAK" "$TARGET" && echo 일치 || echo '⚠️ 불일치')"
