#!/usr/bin/env bash
# 초등 그림 엔진의 새 가드를 **망가뜨려** 시험이 빨개지는지 본다 (원장님 육안 2026-08-22).
#
# 🔴 순서는 ⑴ 파일이 바뀌었나 ⑵ **산출물이 바뀌었나** ⑶ 그제서야 시험이 빨개지나.
#    ⑵ 를 건너뛰면 동작을 안 바꾸는 변이를 「가드가 아니다」로 읽고 멀쩡한 시험을
#    고치러 간다 (CLAUDE.md 2026-08-21).
#
# ⚠️ **이 하네스는 공유 워크트리의 파일을 제자리에서 고친다.** `renderFigureSpec.ts` 가
#    `process.cwd()` 로 `scripts/figure/render_spec.py` 를 찾으므로 복사본으로는 못 돌린다.
#    2026-08-22 에 이것 때문에 **다른 세션이 두 번 거짓 보고**를 했다 —
#    한 번은 「`_cuboid` 에 숨은 모서리가 없다」(변이 ① 적용 중 코드를 읽음),
#    한 번은 「원뿔 기울기 8.24 로 2건 빨강」(변이 ③ 적용 중 전체 관문을 돌림).
#    그래서 도는 동안 **`git status` 에 뜨는 표지 파일**을 둔다. 남이 이 저장소에서
#    이상한 것을 보면 그 파일이 먼저 눈에 띄어야 한다.
set -u
cd "$(dirname "$0")/../.." || exit 1

ADV=scripts/figure/elem_advanced.py
BASE=scripts/figure/elementary.py
# 표지는 **저장소 뿌리**에 `MUTATION-IN-PROGRESS.<하네스이름>.txt` (team-lead 가 정한 규약).
# 예전에는 `scripts/figure/` 밑에 뒀는데 team-lead 표지는 `scripts/qa/` 였다 —
# **갈려 있으면 서로 자기 쪽만 본다.** 실제로 team-lead 의 대기 스크립트가 뿌리만
# 훑어서 내 표지를 못 봤다. 뿌리에 모으면 `ls MUTATION-IN-PROGRESS.*` 한 줄로 다 보인다.
FLAG=MUTATION-IN-PROGRESS.elem-figure.txt
BAK_ADV=$(mktemp)
BAK_BASE=$(mktemp)
BEFORE=$(mktemp)
cp "$ADV" "$BAK_ADV"
cp "$BASE" "$BAK_BASE"

restore() { cp "$BAK_ADV" "$ADV"; cp "$BAK_BASE" "$BASE"; }
cleanup() { restore; rm -f "$FLAG"; }
# 죽어도 원본을 되돌린다. 중간에 끊기면 변이가 그대로 남아 다음 사람이 그걸 읽는다.
trap 'cleanup; echo "중단 — 원상 복구했다"; exit 130' INT TERM
trap 'cleanup' EXIT

cat > "$FLAG" <<FLAGTXT
⚠️ scripts/qa/mutate-elem-figure.sh 가 도는 중이다 (elem-figures 세션).

  PID   : $$          ← 살아 있나: \`kill -0 $$ 2>/dev/null && echo 산다 || echo 죽었다\`
  시작  : $(date '+%Y-%m-%d %H:%M:%S')
  대상  : scripts/figure/elementary.py · scripts/figure/elem_advanced.py

죽은 프로세스의 표지만 남았으면(위 kill -0 이 「죽었다」) 이 파일을 지우고
\`git diff scripts/figure/\` 로 변이 잔재가 없는지 확인해라.
FLAGTXT
cat >> "$FLAG" <<'FLAGTXT'

지금 `scripts/figure/elementary.py` 와 `elem_advanced.py` 는 **일부러 망가뜨린 상태**일 수
있다. 이 파일이 있는 동안에는:

  · 그 두 파일의 코드를 읽고 결함을 판정하지 마라
  · `elementaryFigure.test.ts` 의 빨강을 보고하지 마라 (일부러 빨갛게 만드는 중이다)
  · 전체 관문 수치를 적지 마라

끝나면 이 파일은 저절로 지워지고 두 파일은 원본으로 되돌아간다. 몇 분 걸린다.
남아 있는데 아무도 안 돌리고 있으면 `git diff scripts/figure/` 로 확인하고 지워라.
FLAGTXT

python scripts/qa/probe-elem-figure.py > "$BEFORE" 2>&1

run() { # $1=이름
  local after; after=$(mktemp)
  if cmp -s "$BAK_ADV" "$ADV" && cmp -s "$BAK_BASE" "$BASE"; then
    echo "[$1] 🔴 **파일이 안 바뀌었다 — 앵커가 없다.** 판정 안 함"; restore; return
  fi
  python scripts/qa/probe-elem-figure.py > "$after" 2>&1
  if cmp -s "$BEFORE" "$after"; then
    echo "[$1] 🔴 **산출물이 그대로다 — 동작을 안 바꾸는 변이다.** 판정 안 함"; restore; return
  fi
  local r
  r=$(npx vitest run src/__tests__/unit/elementaryFigure.test.ts 2>&1 \
        | grep -oE "Tests +[0-9]+ failed" | head -1)
  echo "[$1] ${r:-🟢 전부 초록 ← 가드가 아니다}"
  restore
}

# ① 숨은 모서리를 면 **뒤**에 깐다 (원래 결함: 칠에 덮여 막힌 덩어리)
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = """    parts = (
        [svg for _, svg in faces]
        + [_poly(top, FACE_TOP, 1.2)]
        + _hidden_lines(view, verts3, faces_idx)
    )"""
assert old in s, "앵커 없음 ①"
new = """    parts = (
        _hidden_lines(view, verts3, faces_idx)
        + [svg for _, svg in faces]
        + [_poly(top, FACE_TOP, 1.2)]
    )"""
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "각기둥 숨은 모서리를 면 뒤로"

# ② 모선(꼭대기에 닿는) 숨은 모서리를 빼먹는다 — 원장님이 찍으신 「모선 점선이 없음」
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "    return sorted(e for e, flags in seen.items() if len(flags) == 2 and all(flags))"
assert old in s, "앵커 없음 ②"
new = ("    last = len(verts3) - 1\n"
       "    return sorted(e for e, flags in seen.items()\n"
       "                  if len(flags) == 2 and all(flags) and last not in e)")
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "모선 숨은 모서리 빼먹기"

# ③ 원기둥·원뿔을 사방(45°) 투영으로 되돌린다 — 밑면이 기울어 「타원기둥」이 된다
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "ROUND_RATIO = 0.30\nROUND_DEG = 90.0"
assert old in s, "앵커 없음 ③"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "ROUND_RATIO = 0.5\nROUND_DEG = 45.0", 1))
PY
run "원기둥 밑면을 기운 타원으로"

# ④ 원기둥 옆면을 네 점 사각형으로 — 밑면을 가로지르는 실선이 남는다
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "        _poly(near_top + near_bot, FACE_FRONT, 1.15),"
assert old in s, "앵커 없음 ④"
new = ("        _poly([near_top[0], near_top[-1], near_bot[0], near_bot[-1]],\n"
       "              FACE_FRONT, 1.15),")
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "원기둥 옆면을 네 점 사각형으로"

# ⑤ viewBox 맞춤을 끈다 — 전개도 꼭짓점이 다시 잘려야 한다
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "    box = _body_bbox(body)\n    if box is not None:"
assert old in s, "앵커 없음 ⑤"
io.open(p, "w", encoding="utf-8").write(
    s.replace(old, "    box = _body_bbox(body)\n    if False:  # 변이", 1)
)
PY
run "viewBox 맞춤 끄기"

# ⑥ 마름모에 라벨을 되돌린다 — 원장님이 「너저분하다」고 빼기로 하신 그것
#    (예전 변이는 「날 텍스트로 되돌리기」였는데 그 코드가 통째로 사라져 앵커가 죽었다.
#     변이는 **지금 지키는 규칙**을 겨눠야 낡지 않는다.)
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '        parts.append(_line(pts[1], pts[3], sw=1.05, dash="5 4"))'
assert old in s, "앵커 없음 ⑥"
new = old + '\n        parts.append(_text(cx, cy + 13, f"{_n(base)} cm", size=12))  # 변이'
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "마름모에 라벨 되돌리기"

# ⑮ 마름모 대각선 점선을 뺀다 — 라벨을 뺐으니 이 선마저 없으면 넓이 규칙이 안 보인다
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '        parts.append(_line(pts[0], pts[2], sw=1.05, dash="5 4"))\n'
assert old in s, "앵커 없음 ⑮"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "", 1))
PY
run "마름모 대각선 점선 빼기"

# ⑦ 등변 tick·직각 기호를 기본으로 켠다 — 그림이 답을 알려 준다
#    ⚠️ 함수 기본값(`marks: bool = False`)을 바꾸는 변이는 **산출물이 그대로**다 —
#       부르는 쪽이 늘 값을 넘기므로 기본값을 안 탄다. 부르는 자리를 바꿔야 한다.
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '        marks = item.get("marks", False)'
assert old in s, "앵커 없음 ⑦"
io.open(p, "w", encoding="utf-8").write(
    s.replace(old, '        marks = item.get("marks", True)  # 변이', 1)
)
PY
run "등변 tick 기본 켜기"

# ⑧ 겹침 회피 회전을 끈다 — 숨은 점선이 실선 모서리에 달라붙어야 한다
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "    base += _spread_rotation(n, base, ratio, deg, apex_h)"
assert old in s, "앵커 없음 ⑧"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "    base += 0.0  # 변이", 1))
PY
run "꼭짓점 겹침 회피 회전 끄기"

# ⑨ 도형 항목 키 검사를 뺀다 — 오타가 조용히 무시된다
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "        extra = set(item) - _SHAPE_ITEM_KEYS"
assert old in s, "앵커 없음 ⑨"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "        extra = set()  # 변이", 1))
PY
run "도형 항목 오타 키 허용"

# ⑩ viewBox 는 넓히되 **내용은 안 민다** — 음수 쪽으로 나간 것은 그대로 잘린다.
#    ⑤ 가 초록이어도 이쪽이 안 걸리면 「넓히기」만 지키고 「밀기」는 안 지키는 것이다.
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "            body = _shift_body(body, dx, dy)"
assert old in s, "앵커 없음 ⑩"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "            pass  # 변이", 1))
PY
run "내용 밀기 끄기 (넓히기만)"

# ⑪ 이등변삼각형 밑변을 되돌린다 — 표시가 꺼진 채로 정삼각형과 안 갈린다(실측 3.93px)
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "ISO_TRI_BASE = 0.58"
assert old in s, "앵커 없음 ⑪"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "ISO_TRI_BASE = 1.0  # 변이", 1))
PY
run "이등변삼각형 밑변 되돌리기"

# ⑫ 사다리꼴 높이 값을 뺀다 — 지면에 설명 없는 점선이 남는다
python - "$ADV" <<'PY'
import io, re, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
m = re.search(r"        parts\.append\(\n            _length_mark\(hx.*?\n        \)\n", s, re.S)
assert m, "앵커 없음 ⑫"
io.open(p, "w", encoding="utf-8").write(s[: m.start()] + s[m.end() :])
PY
run "사다리꼴 높이 값 빼기"

# ⑬ 마름모 세로를 다시 `height` 로 — 적힌 `d2` 와 그림이 갈린다
python - "$ADV" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = '    vertical = _num(spec.get("d2", height), "d2", 0.5, 40) if shape == "rhombus" else height'
assert old in s, "앵커 없음 ⑬"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "    vertical = height  # 변이", 1))
PY
run "마름모 세로를 height 로 되돌리기"

# ⑭ `diamond` 를 키워 **정사각형을 45° 돌린 것**과 합동으로 만든다.
#    이 변이의 값어치: **하우스도르프 거리는 9.1px 로 초록**이다(자세가 달라 멀어 보인다).
#    회전 불변 지문만 이것을 잡는다 — 두 축이 서로를 갈음하지 못한다는 증거다.
python - "$BASE" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "            [(ox + s / 2, oy), (ox + s, oy + s / 2), (ox + s / 2, oy + s), (ox, oy + s / 2)]"
assert old in s, "앵커 없음 ⑭"
new = ("            [(ox + s / 2, oy - s * 0.2071), (ox + s * 1.2071, oy + s / 2),\n"
       "             (ox + s / 2, oy + s * 1.2071), (ox - s * 0.2071, oy + s / 2)]  # 변이")
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "마름모를 돌린 정사각형과 합동으로"

restore
echo "원상 복구 완료"
