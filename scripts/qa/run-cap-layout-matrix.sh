#!/usr/bin/env bash
# 「그림 폭 상한 × 문항번호 서식」 표를 처음부터 다시 만든다 (읽기 전용 · 서너 시간 걸린다).
#
#   bash scripts/qa/run-cap-layout-matrix.sh
#
# 네 갈래로 나눠 동시에 돌린다. 코어 8개에서 **셋~넷이 한계**다 — 그 이상은 서로
# 느려져서 총량이 안 는다(실측: 셋일 때 CPU 76%). 전수 한 조건이 약 40분,
# 그림 있는 문항만이면 약 8분이다.
#
# ⚠️ 공유 DB(D-31)는 이 몇 시간 동안에도 움직인다(이번에도 그림이 121건 붙었다).
#    그래서 마지막에 `--patch` 로 조건 파일마다 «잰 뒤 바뀐 행»을 다시 그려 맞춘다 —
#    안 그러면 「45mm 가 낮다」의 일부가 상한이 아니라 **잰 시각의 차이**가 된다.
set -eu
cd "$(dirname "$0")/../.."
mkdir -p .measure/logs

run() { # run <로그이름> <인자...>
  local name="$1"; shift
  npx tsx scripts/qa/measure-cap-layout.tsx "$@" > ".measure/logs/$name.log" 2>&1
  echo "EXIT=$?" >> ".measure/logs/$name.log"
}

# 전제 — 문항 높이가 «몇째 장인가»와 무관한가. 참이라야 한 번 재서 484·405 둘 다 센다.
npx tsx scripts/qa/measure-cap-layout.tsx --verify-page-kind --take 3000
# 가드가 정말 가드인지 — 덧칠을 하나씩 망가뜨려 멈추는지 본다.
bash scripts/qa/mutate-cap-layout-guards.sh

# ── 갈래 A: 상한별 기준선(전수) ────────────────────────────────────────────
(
  run cap70-base --cap cap70 --layout base --identity .measure/cont.json --json .measure/cl-cap70-base.json
  run cap45-base --cap cap45 --layout base --json .measure/cl-cap45-base.json
) &
# ── 갈래 B: 70mm 에서 배치별(전수) — 여기서 나온 Δ 가 다른 상한에서도 같은지 본다 ──
(
  run cap70-d        --cap cap70 --layout d        --json .measure/cl-cap70-d.json
  run cap70-dtight-a --cap cap70 --layout dtight-a --json .measure/cl-cap70-dtight-a.json
) &
# ── 갈래 C: 다른 상한 × 배치 — **그림 있는 문항만** 다시 그린다 ─────────────
#    (그림 없는 문항은 상한 덧칠이 아무것도 못 고르므로 지면이 같다. 그 전제는
#     `report-cap-layout.ts` 가 상한별 전수 파일끼리 대조해 숫자로 확인한다.)
(
  for C in cap45 cap29 cap55; do
    for L in d dtight-a; do
      run "$C-$L-fig" --cap "$C" --layout "$L" --only figures --json ".measure/cl-$C-$L-fig.json"
    done
  done
) &
# ── 갈래 D: 나머지 상한 기준선(전수) ───────────────────────────────────────
(
  run cap29-base --cap cap29 --layout base --json .measure/cl-cap29-base.json
  run cap55-base --cap cap55 --layout base --json .measure/cl-cap55-base.json
) &
wait

# ── 공유 DB 가 그 사이 움직인 자리를 맞춘다 (바뀐 행·새로 들어온 행·빠져야 할 행) ──
for F in .measure/cl-*.json; do
  case "$F" in *manifest*) continue;; esac
  CAP=$(basename "$F" .json | cut -d- -f2)
  LAYOUT=$(basename "$F" .json | sed -E 's/^cl-[^-]+-//; s/-fig$//')
  npx tsx scripts/qa/measure-cap-layout.tsx --patch "$F" --cap "$CAP" --layout "$LAYOUT"
done

# ── 표 (넘침 484/405 · 문턱 밀집 · 판정 정확도) ─────────────────────────────
npx tsx scripts/qa/report-cap-layout.ts --write

# ── 경고 뜨는 시험지 (실제 출제 엔진 + 제품 판정) ──────────────────────────
for CAP in cap70 cap55 cap45 cap29 policy; do
  for LAYOUT in base d dtight-a; do
    echo "══ $CAP × $LAYOUT"
    npx tsx scripts/qa/simulate-overflow-policies.ts --counts 8,25 \
      --cap "$CAP" --layout "$LAYOUT" \
      --heights ".measure/mix-$CAP-$LAYOUT.json" \
      --baseline-heights ".measure/mix-$CAP-base.json"
  done
done
