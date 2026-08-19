# -*- coding: utf-8 -*-
"""「짝이 있다」와 「짝이 맞다」는 다른 말이다 — **번호를 일부러 뒤바꿔** 잡히는지 본다.

회수기는 열쇠 둘(㉮ 순서 · ㉯ 기하)이 어긋나면 «사람확인» 으로 내린다고 적었다.
그런데 `choice_run()` 은 **늘 [1,2,…,k] 를 돌려준다**(1부터 1씩 잇는 가장 긴 연속을
고르므로). 그래서 마지막 대조

    [key_geom[f] for f in choice_figs] != [m["n"] for m in marks]

는 사실상 **「기하 배정을 그림 읽기 순서로 늘어놓으면 1,2,3,…,n 인가」** 한 가지다.
즉 열쇠가 둘이 아니라 **하나 + 불변식(전단사·단조)** 이다.

그렇다면 그 불변식이 «뒤바뀜» 을 실제로 잡는가? 세 가지로 망가뜨려 본다:
  ㉠ 두 그림의 기하 배정을 **맞바꾼다** (①↔②)
  ㉡ 배정을 통째로 **한 칸 돌린다** (①→②→③→④→⑤→①)
  ㉢ 그림 읽기 순서를 **뒤집는다** (지면 배치를 거꾸로 읽는다)

잡히면 «자동» 이 줄어야 한다. 안 줄면 그 검사는 뒤바뀜을 못 본다.
"""
from __future__ import annotations
import importlib.util, json, pathlib, sys

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load():
    spec = importlib.util.spec_from_file_location(
        "rec_%d" % len(sys.modules), ROOT / "scripts/qa/choice_figure_recover.py"
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


items = [
    c
    for c in json.loads((ROOT / "scripts/qa/reports/choice-figure-candidates.json").read_text(encoding="utf-8"))
    if c["group"] == "보기그림"
]
base_pairs = {
    p["id"]: p
    for p in json.loads((ROOT / "scripts/qa/reports/choice-figure-pairs.json").read_text(encoding="utf-8"))
}
auto_ids = {i for i, p in base_pairs.items() if p["verdict"] == "자동"}
targets = [c for c in items if c["id"] in auto_ids]
figroot = ROOT / "public/figures"


def run(mutator, label):
    rec = load()
    if mutator:
        mutator(rec)
    still_auto, downgraded, changed_pair = 0, 0, 0
    for c in targets:
        try:
            out = rec.recover_one(c, figroot)
        except Exception:
            downgraded += 1
            continue
        if out["verdict"] != "자동":
            downgraded += 1
            continue
        still_auto += 1
        if out.get("choiceFigureIndex") != base_pairs[c["id"]].get("choiceFigureIndex"):
            changed_pair += 1
    print(
        "%-46s 자동 %3d / %3d · «사람확인·불가» 로 내려감 %3d · 자동인데 짝이 달라짐 %3d"
        % (label, still_auto, len(targets), downgraded, changed_pair)
    )
    return still_auto, changed_pair


def swap_first_two(rec):
    """㉠ 기하 배정에서 ①과 ②를 맞바꾼다."""
    orig = rec.geometric_owner

    def patched(fig, marks):
        n = orig(fig, marks)
        return 2 if n == 1 else 1 if n == 2 else n

    rec.geometric_owner = patched


def rotate_all(rec):
    """㉡ 배정을 한 칸씩 돌린다 (①→②, …, ⑤→①)."""
    orig = rec.geometric_owner

    def patched(fig, marks):
        n = orig(fig, marks)
        if n is None:
            return None
        ns = sorted({m["n"] for m in marks})
        return ns[(ns.index(n) + 1) % len(ns)] if n in ns else n

    rec.geometric_owner = patched


def reverse_reading(rec):
    """㉢ 그림 읽기 순서를 뒤집는다."""
    orig = rec.row_order
    rec.row_order = lambda figs: list(reversed(orig(figs)))


print("자동 97건에 변이를 걸어 «자동» 이 살아남는지 본다\n")
run(None, "변이 없음 (기준)")
run(swap_first_two, "㉠ ①↔② 맞바꿈")
run(rotate_all, "㉡ 배정을 한 칸 돌림")
run(reverse_reading, "㉢ 그림 읽기 순서 뒤집기")
