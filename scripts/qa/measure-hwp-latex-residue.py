# -*- coding: utf-8 -*-
"""트랙 D-3 — 변환 뒤에도 남은 **HWP 스크립트 잔재**를 센다.

KaTeX 는 `1over5x` 를 에러로 보지 않고 그냥 글자로 그린다. 그래서 렌더 실패율로는
안 잡히고 지면에만 나타난다 — 이 지표가 `hwpeq_unglue.py` 의 유일한 성적표다.

  python scripts/qa/measure-hwp-latex-residue.py
"""
import collections, json, pathlib, re, sys
sys.stdout.reconfigure(encoding="utf-8")
BS = chr(92)
SPAN = re.compile(r"[$]([^$]+)[$]")
LEFTOVER = ["over", "atop", "pile", "LEFT", "RIGHT", "SUM", "INT", "LIM",
            "TIMES", "DIV", "CDOT", "ANGLE", "TRIANGLE", "SQRT", "ROOT", "OF"]
# 백슬래시(LaTeX 명령)나 다른 영문자에 이어지지 않은 **맨 키워드**만 잔재로 센다.
PATS = {kw: re.compile("(?<![A-Za-z" + BS + BS + "])" + kw + "(?![A-Za-z])") for kw in LEFTOVER}
GLUED = re.compile("[A-Za-z0-9](over|atop|sqrt|root)[A-Za-z0-9]")
cnt = collections.Counter(); spans = 0; bad = 0
glued = collections.Counter(); badq = 0; qs_all = 0
for f in sorted(pathlib.Path("scripts/qa/reports/hwp-latex").glob("*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    for q in d.get("questions") or []:
        qs_all += 1
        txt = (q.get("stem") or "") + chr(10) + chr(10).join(q.get("choices") or [])
        qbad = False
        for e in SPAN.findall(txt):
            spans += 1
            hit = False
            for kw, p in PATS.items():
                n = len(p.findall(e))
                if n: cnt[kw] += n; hit = True
            for m in GLUED.finditer(e):
                glued[m.group(1)] += 1; hit = True
            if hit: bad += 1; qbad = True
        if qbad: badq += 1
print("문항 %d · 수식 span %d" % (qs_all, spans))
print("잔재 span %d (%.2f%%) · 잔재 문항 %d (%.2f%%)" % (bad, bad*100/max(1,spans), badq, badq*100/max(1,qs_all)))
print("맨 키워드 잔재:", cnt.most_common(12))
print("붙어버린 키워드:", glued.most_common())