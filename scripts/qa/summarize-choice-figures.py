# -*- coding: utf-8 -*-
"""보고서에 실을 표를 **만들어 낸다** — 손으로 옮겨 적지 않기 위해.

  python scripts/qa/summarize-choice-figures.py > docs/planning/tracks/reports/choice-figures-tables.md

입력은 두 산출물뿐이다:
  scripts/qa/reports/choice-figure-candidates.json  (DB 쪽 판정)
  scripts/qa/reports/choice-figure-pairs.json       (원본 쪽 회수)
"""
from __future__ import annotations

import collections
import io
import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

R = pathlib.Path("scripts/qa/reports")
cands = json.loads((R / "choice-figure-candidates.json").read_text(encoding="utf-8"))
pairs = {
    r["id"]: r
    for r in json.loads((R / "choice-figure-pairs.json").read_text(encoding="utf-8"))
}
by_id = {c["id"]: c for c in cands}


def table(rows, head):
    print("| " + " | ".join(head) + " |")
    print("| " + " | ".join(["---"] * (len(head) - 1) + ["---:"]) + " |")
    for r in rows:
        print("| " + " | ".join(str(x) for x in r) + " |")
    print()


print("<!-- 이 파일은 scripts/qa/summarize-choice-figures.py 가 만든다. 손으로 고치지 말 것. -->")
print("# 보기 그림 짝 — 도구 산출 표\n")

print("## A. DB 쪽 판정 — 무리별 건수\n")
g = collections.Counter(c["group"] for c in cands)
table([[k, v] for k, v in g.most_common()], ["무리", "건수"])

print("## B. 원본 쪽 회수 결과 — 무리 × 판정\n")
gv = collections.Counter((c["group"], pairs[c["id"]]["verdict"]) for c in cands)
groups = ["보기그림", "미분류", "반대쪽"]
verdicts = ["자동", "사람확인", "불가"]
rows = []
for grp in groups:
    tot = sum(gv[(grp, v)] for v in verdicts)
    rows.append([grp] + [gv[(grp, v)] for v in verdicts] + [tot])
table(rows, ["무리", "자동", "사람확인", "불가", "합"])

print("## C. «보기그림» 안에서 사유별\n")
w = collections.Counter(
    (pairs[c["id"]]["verdict"], pairs[c["id"]].get("why") or "")
    for c in cands
    if c["group"] == "보기그림"
)
table([[v, why or "—", n] for (v, why), n in w.most_common()], ["판정", "사유", "건수"])

print("## D. «보기그림» 의 속모양 (DB 쪽 지표)\n")
t = collections.Counter(
    (c["markerState"], c["markRel"]) for c in cands if c["group"] == "보기그림"
)
table([[a, b, n] for (a, b), n in t.most_common()], ["본문 마커 잔존", "그림 표시 수", "건수"])

print("## E. 그림 장수 분포 (보기그림)\n")
t = collections.Counter(c["nFig"] for c in cands if c["group"] == "보기그림")
table([[f"{k}장", v] for k, v in sorted(t.items())], ["그림", "건수"])

print("## F. 원본 소재 (보기그림)\n")
t = collections.Counter()
for c in cands:
    if c["group"] != "보기그림":
        continue
    r = pairs[c["id"]]
    if not c.get("sourceFile"):
        t["원본 메타 없음 (RPM 이관본 등)"] += 1
    elif r.get("figureSource") == "hwp":
        t["HWP 정본에서 오려 온 그림"] += 1
    elif "(완료)" in c["sourceFile"]:
        t["완료본 PDF (D-37 적합)"] += 1
    else:
        t["완료본 아님"] += 1
table([[k, v] for k, v in t.most_common()], ["원본", "건수"])

print("## G. 자동 회수분의 모양 — 발문 그림이 있었나\n")
t = collections.Counter()
for c in cands:
    r = pairs[c["id"]]
    if c["group"] == "보기그림" and r["verdict"] == "자동":
        t[(len(r.get("stem") or []), len(r.get("pairs") or {}))] += 1
table(
    [[f"발문 {a}장", f"보기 {b}장", n] for (a, b), n in sorted(t.items())],
    ["발문", "보기", "건수"],
)

print("## H. 자동 회수분 전량 — 문항별 짝\n")
rows = []
for c in cands:
    r = pairs[c["id"]]
    if c["group"] != "보기그림" or r["verdict"] != "자동":
        continue
    pr = r.get("pairs") or {}
    order = sorted(pr.items(), key=lambda kv: kv[1])
    rows.append(
        [
            c["id"][:8],
            c["school"] or "?",
            f"{c['questionNumber']}번",
            c["examId"],
            c["answer"],
            " ".join(f"{n}←{i}" for i, n in order),
        ]
    )
rows.sort(key=lambda r: (r[1], r[0]))
table(rows, ["id", "학교", "문항", "시험지", "정답", "보기←그림첨자"])
print(f"자동 회수 **{len(rows)}건**. `보기←그림첨자` 의 첨자는 `q<번호>_<첨자>` 파일 이름의 첨자다.\n")

print("## I. 사람이 봐야 하는 것 (보기그림 · 사람확인)\n")
rows = []
for c in cands:
    r = pairs[c["id"]]
    if c["group"] != "보기그림" or r["verdict"] != "사람확인":
        continue
    rows.append([c["id"][:8], c["school"] or "?", f"{c['questionNumber']}번", r.get("why") or ""])
table(rows, ["id", "학교", "문항", "사유"])

print("## J. 원본 쪽이 «보기가 그림» 이라는데 DB 본문은 아니라는 것 (반대쪽·미분류)\n")
rows = []
for c in cands:
    r = pairs[c["id"]]
    if c["group"] == "보기그림":
        continue
    if r["verdict"] != "사람확인":
        continue
    if "어긋난다" not in (r.get("why") or ""):
        continue
    rows.append([c["id"][:8], c["group"], c["school"] or "?", f"{c['questionNumber']}번", r.get("why") or ""])
table(rows, ["id", "무리", "학교", "문항", "사유"])
