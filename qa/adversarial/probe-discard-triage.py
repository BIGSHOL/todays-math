# -*- coding: utf-8 -*-
"""뺄 43건을 «정말 보기 그림 문항인가» 로 다시 가른다.

CLAUDE.md 2026-08-18 «가른 것은 question_type 이 아니라 **정답 모양**이다»
(정답이 ① 인데 «서술형» 이라 적힌 행이 36건이라 그 컬럼은 못 쓴다).

객관식이 아니면 「어느 그림이 ①인가」라는 물음 자체가 성립하지 않는다.
"""
from __future__ import annotations
import json, pathlib, re, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
rows = json.loads((ROOT / "qa/adversarial/discard43.json").read_text(encoding="utf-8"))

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
# 「정답이 보기 번호 하나(또는 몇 개)」인가 — 객관식의 지문
MC_ANSWER = re.compile(r"^\s*[①-⑩1-5](\s*[,·]\s*[①-⑩1-5])*\s*$")
CHOICE_LINE = re.compile(r"(?m)^[ \t]*(?:([1-9][0-9]?)[.)][ \t]+|([①-⑩])[ \t]*)(.*)$")


def filled_text_choices(content: str) -> int:
    """«진짜 글자» 가 든 보기 자리 수 — 그림 표시를 걷어낸 뒤."""
    n = 0
    for m in CHOICE_LINE.finditer(content or ""):
        body = (m.group(3) or "").replace("[그림]", "").strip()
        if body:
            n += 1
    return n


out = []
for r in rows:
    ans = (r["answer"] or "").strip()
    mc = bool(MC_ANSWER.match(ans))
    content = r["content"] or ""
    has_fig_mark = "[그림]" in content
    body_no_choice = CHOICE_LINE.sub("", content)
    out.append({
        "id": r["id"][:8], "school": r["school"], "q": r["q"], "why": r["why"],
        "keys": r["keys"], "type": r["questionType"], "ans": ans[:24],
        "objective": mc, "nFig": r["nFig"], "nMark": r["nMark"],
        "filledText": filled_text_choices(content),
        "hasFigMark": has_fig_mark,
        "len": len(content),
    })

obj = [o for o in out if o["objective"]]
sub = [o for o in out if not o["objective"]]
print("정답이 보기 번호(객관식 지문)      %2d건" % len(obj))
print("정답이 보기 번호가 **아니다**      %2d건  ← 「어느 그림이 ①인가」가 성립하지 않는다" % len(sub))
print()
print("── 객관식이 아닌 것 (보기 그림 문항일 수 없다) ──")
print("%-9s %-9s %4s %-9s %-26s %5s %5s %6s %s" % ("id", "school", "q", "type", "answer", "nFig", "nMark", "filled", "keys"))
for o in sorted(sub, key=lambda x: -x["nFig"]):
    print("%-9s %-9s %4s %-9s %-26s %5d %5d %6d %s" % (
        o["id"], (o["school"] or "?")[:9], o["q"], (o["type"] or "?"), o["ans"], o["nFig"], o["nMark"], o["filledText"], ",".join(o["keys"])))

print()
print("── 객관식이면서 «보기 글자가 다섯 다 찬» 것 (보기가 그림이 아니다) ──")
for o in sorted(obj, key=lambda x: -x["filledText"]):
    if o["filledText"] >= 5:
        print("%-9s %-9s %4s  답%-6s 그림%2d 표시%2d 글자보기%d  %s" % (
            o["id"], (o["school"] or "?")[:9], o["q"], o["ans"], o["nFig"], o["nMark"], o["filledText"], ",".join(o["keys"])))

(ROOT / "qa/adversarial/triage43.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
