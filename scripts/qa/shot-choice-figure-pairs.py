# -*- coding: utf-8 -*-
"""되찾은 짝을 **눈으로 볼 수 있게** 원본 지면 위에 그린다 (읽기 전용).

이 저장소가 열 번 배운 것: 규칙은 **표본을 눈으로 봐야** 틀린 게 보인다.
그런데 「짝이 맞나」를 짝을 만든 규칙으로 채점하면 동어반복이다. 그래서 이 그림은
**채점하지 않는다** — 원본 지면을 그대로 오려 놓고 그 위에 내가 되찾은 번호를
빨간 글씨로 얹을 뿐이다. 지면에는 인쇄된 ①②③④⑤ 가 **이미 찍혀 있으므로**,
빨간 번호와 검은 번호가 다르면 한눈에 보인다. 판정 근거가 그림 안에 같이 있다.

  python scripts/qa/shot-choice-figure-pairs.py --verdict 자동 --per 6
  → scripts/qa/reports/shots/choice-pairs-자동-01.png …
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import pathlib
import sys

import fitz
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "mapfig", ROOT / "scripts" / "figure" / "map-figures.py"
)
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DPI = 110
PAD = 10


def _font(size: int):
    for name in ("malgun.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:  # noqa: BLE001
            continue
    return ImageFont.load_default()


def render_one(item: dict, rec: dict) -> Image.Image | None:
    pdf = pathlib.Path((item.get("sourceFile") or "").replace("\\", "/"))
    if not pdf.exists():
        return None
    qnum = rec.get("figureQnum")
    if qnum is None:
        return None
    doc = fitz.open(pdf)
    try:
        figs = mapfig.map_exam(pdf).get(qnum) or []
    except Exception:  # noqa: BLE001
        doc.close()
        return None
    if not figs:
        doc.close()
        return None

    pno = figs[0]["page"]
    page = doc[pno]
    # 이 문항이 차지하는 세로 구간 — 그림들과 (있으면) 문항 앵커를 다 담는다.
    xs = [f["rect"][0] for f in figs if f["page"] == pno]
    xs += [f["rect"][2] for f in figs if f["page"] == pno]
    ys = [f["rect"][1] for f in figs if f["page"] == pno]
    ys += [f["rect"][3] for f in figs if f["page"] == pno]
    anchors, _ = mapfig._page_layout(page)
    top = min(ys)
    for _, ay, n in anchors:
        if n == qnum and ay < top:
            top = ay
    mid = page.rect.width / 2
    left = 0 if min(xs) < mid else mid
    clip = fitz.Rect(
        max(0, left - 8), max(0, top - 12), min(page.rect.width, left + mid + 8),
        min(page.rect.height, max(ys) + 24),
    )
    pix = page.get_pixmap(clip=clip, dpi=DPI)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("RGB")
    d = ImageDraw.Draw(img)
    s = DPI / 72.0
    f = _font(26)
    pairs = rec.get("pairs") or rec.get("byGeometry") or {}
    stem = set(rec.get("stem") or [])
    for i, fig in enumerate(figs):
        if fig["page"] != pno:
            continue
        x0, y0, x1, y1 = fig["rect"]
        box = [
            (x0 - clip.x0) * s,
            (y0 - clip.y0) * s,
            (x1 - clip.x0) * s,
            (y1 - clip.y0) * s,
        ]
        n = pairs.get(str(i))
        colour = (200, 0, 0) if n else (0, 120, 200)
        d.rectangle(box, outline=colour, width=2)
        label = str(n) if n else ("발문" if i in stem else "?")
        d.rectangle([box[0], box[1], box[0] + 34, box[1] + 30], fill=colour)
        d.text((box[0] + 8, box[1] + 2), label, fill=(255, 255, 255), font=f)
    doc.close()

    cap = "%s %s %s번 (파일 q%02d) · %s" % (
        item["id"][:8],
        item.get("school") or "?",
        item.get("questionNumber"),
        qnum,
        rec.get("why") or rec["verdict"],
    )
    band = Image.new("RGB", (img.width, 26), (245, 245, 245))
    ImageDraw.Draw(band).text((4, 4), cap, fill=(0, 0, 0), font=_font(16))
    out = Image.new("RGB", (img.width, img.height + 26), (255, 255, 255))
    out.paste(band, (0, 0))
    out.paste(img, (0, 26))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default="scripts/qa/reports/choice-figure-pairs.json")
    ap.add_argument("--cands", default="scripts/qa/reports/choice-figure-candidates.json")
    ap.add_argument("--verdict", default="자동")
    ap.add_argument("--group", default="보기그림")
    ap.add_argument("--per", type=int, default=6)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--out", default="scripts/qa/reports/shots")
    ap.add_argument("--ids", help="쉼표로 나눈 id 앞자리 — 이것만 그린다")
    ap.add_argument("--tag", default=None, help="파일 이름에 쓸 꼬리표")
    a = ap.parse_args()

    pairs = {
        r["id"]: r
        for r in json.loads(pathlib.Path(a.pairs).read_text(encoding="utf-8"))
    }
    cands = json.loads(pathlib.Path(a.cands).read_text(encoding="utf-8"))
    picked = [
        c
        for c in cands
        if (a.group in ("*", c["group"]))
        and pairs.get(c["id"], {}).get("verdict") == (
            None if a.verdict == "*" else a.verdict
        )
    ]
    if a.verdict == "*":
        picked = [c for c in cands if a.group in ("*", c["group"])]
    if a.ids:
        want = tuple(x.strip() for x in a.ids.split(",") if x.strip())
        picked = [c for c in cands if c["id"].startswith(want)]
    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)

    tiles = []
    for c in picked:
        img = render_one(c, pairs[c["id"]])
        if img is not None:
            tiles.append(img)
    print("그린 것 %d / 고른 것 %d" % (len(tiles), len(picked)))

    sheets = 0
    for s in range(0, len(tiles), a.per):
        chunk = tiles[s : s + a.per]
        cols = a.cols
        rows = (len(chunk) + cols - 1) // cols
        cw = max(t.width for t in chunk) + PAD
        ch = max(t.height for t in chunk) + PAD
        sheet = Image.new("RGB", (cols * cw, rows * ch), (255, 255, 255))
        for k, t in enumerate(chunk):
            sheet.paste(t, ((k % cols) * cw, (k // cols) * ch))
        sheets += 1
        p = outdir / ("choice-pairs-%s-%02d.png" % (a.tag or a.verdict, sheets))
        sheet.save(p)
    print("장 %d → %s" % (sheets, outdir))


if __name__ == "__main__":
    main()
