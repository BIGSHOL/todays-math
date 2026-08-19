# -*- coding: utf-8 -*-
"""「HWP 변환본만 구하면 19건이 살아난다」를 확인한다.

물을 것 셋:
  ㉮ 그 19건의 **원본이 실제로 있는가** (D-37: `(완료)` 표기만 쓴다)
  ㉯ 원본이 PDF 라면 «HWP 에서 왔다» 는 판정이 무슨 뜻인가
  ㉰ HWPX 변환본이 이 컴퓨터에 있는가
"""
from __future__ import annotations
import json, pathlib, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
rows = json.loads((ROOT / "qa/adversarial/discard43.json").read_text(encoding="utf-8"))
hwp = [r for r in rows if "HWP" in (r["why"] or "")]
print("HWP 사유 %d건" % len(hwp))
print()
ok_done = 0
exists = 0
for r in hwp:
    sf = r["sourceFile"]
    p = pathlib.Path((sf or "").replace(chr(92), "/")) if sf else None
    e = bool(p and p.exists())
    done = "(완료)" in (sf or "")
    exists += e
    ok_done += done
    print("%-9s %-8s %3s번  실재=%-5s (완료)=%-5s  %s" % (
        r["id"][:8], r["school"], r["q"], e, done, sf))
    print("            그림: %s" % [u.split("/")[-1] for u in (r["figureUrls"] or [])][:6])
print()
print("원본 실재 %d/%d · (완료) 표기 %d/%d" % (exists, len(hwp), ok_done, len(hwp)))
