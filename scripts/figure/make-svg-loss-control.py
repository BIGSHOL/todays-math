# -*- coding: utf-8 -*-
"""**획 손실 자의 대조군을 만든다** — 낸 SVG 의 그릴 요소를 절반 지운 것.

「획이 사라졌나」를 재는 자를 만들었으면, **진짜로 사라진 표본**에 대 봐야 뜻이 있다.
없으면 문턱을 어디에 놓아도 근거가 없다.

실제로 이 대조군이 자의 결함을 잡아냈다. 처음 자는 픽셀 대 픽셀로 세어서, 눈으로
보면 똑같은 그림이 「획 손실 54%」로 버려졌다(전량 실행에서 버린 262건 중 242건).
원본은 200dpi 래스터라 가는 선이 번져 있고 SVG 는 또렷해서, 같은 선이 반 픽셀만
어긋나도 «사라졌다»로 세어진 것이다. 한 픽셀 부풀린 뒤 견주도록 고쳤다.

    python scripts/figure/make-svg-loss-control.py     # 변이본 24장을 만든다
    node scripts/figure/render-svg-shots.mjs .work/ctrl/jobs.json

전제: `extract-vector-svg.py` 를 한 번 돌려 `.work/svg-cmp/` 와
      `public/figures-svg/` 가 있어야 한다.
"""
import json
import pathlib
import random
import re
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = pathlib.Path(".")
W = ROOT / ".work" / "ctrl"
W.mkdir(parents=True, exist_ok=True)
for f in W.glob("*"):
    f.unlink()

led = json.loads((ROOT / "scripts/qa/reports/figure-rect-ledger.json").read_text(encoding="utf-8"))
rows = [r for r in led["행"] if r.get("kind") == "vector" and r.get("rect_pt") and r.get("source_exists")]
idx = {r["figure"]: i for i, r in enumerate(rows)}
stem = {k.rsplit(".", 1)[0]: v for k, v in idx.items()}
CMP = ROOT / ".work" / "svg-cmp"

svgs = sorted((ROOT / "public/figures-svg").rglob("*.svg"))
random.seed(11)
jobs = []
pairs = []
for p in random.sample(svgs, min(300, len(svgs))):
    rel = p.relative_to(ROOT / "public/figures-svg").as_posix()
    i = stem.get(rel.rsplit(".", 1)[0])
    if i is None:
        continue
    o = CMP / ("o%06d.png" % i)
    if not o.exists():
        continue
    s = p.read_text(encoding="utf-8")
    bi = s.find("</defs>") + 7
    head, body = s[:bi], s[bi:]
    els = list(re.finditer(r"<(?:path|use|image)\b[^>]*/>", body))
    if len(els) < 10:
        continue
    out, last = [], 0
    for j, m in enumerate(els):
        out.append(body[last:m.start()])
        if j % 2 == 0:
            out.append(m.group(0))
        last = m.end()
    out.append(body[last:])
    k = len(jobs)
    (W / ("c%02d.svg" % k)).write_text(head + "".join(out), encoding="utf-8")
    im = Image.open(o)
    jobs.append({"svg": str((W / ("c%02d.svg" % k)).resolve()),
                 "png": str((W / ("c%02d.png" % k)).resolve()),
                 "w": im.width, "h": im.height})
    pairs.append({"orig": str(o), "made": str(W / ("c%02d.png" % k)),
                  "good": str(CMP / ("m%06d.png" % i)), "figure": rel})
    if len(jobs) >= 24:
        break
(W / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
(W / "pairs.json").write_text(json.dumps(pairs, ensure_ascii=False), encoding="utf-8")
print("변이 대상 %d" % len(jobs))
