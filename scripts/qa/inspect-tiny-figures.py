# -*- coding: utf-8 -*-
"""새 규칙에서 **가장 작아지는 그림**이 실제로 무엇인지 원본 지면에서 확인한다.

    python scripts/qa/inspect-tiny-figures.py             # 15mm 미만 전량
    python scripts/qa/inspect-tiny-figures.py --limit 10  # 10mm 미만만
    python scripts/qa/inspect-tiny-figures.py --sheet     # 대조 시트 PNG 도 만든다
    python scripts/qa/inspect-tiny-figures.py --context 3 # 가장 작은 3장의 원본 지면을 뜬다

## 왜 「글자가 몇 px 인가」로 안 묻나

「작아지면 글자가 읽히는가」를 **픽셀**로 물으면 답이 안 나온다. 픽셀은 크기가 아니라
비율만 안다. 답이 있는 자리는 **원본 지면**이다 —

    새 규칙의 인쇄 폭 = 원본 지면에서 그 그림이 차지하던 물리 폭 (상한 70mm)

이므로 상한에 안 걸리는 그림은 **원본 시험지와 똑같은 크기**로 나간다. 즉 「읽히는가」가
「그 학교 시험지에서 읽혔는가」와 같은 질문이 된다. 원본 라벨이 9pt 였으면 우리 지면에서도
9pt 다. 상한에 걸려 줄어든 그림만 원본보다 작아지므로 그 배율(`상한 축소`)을 따로 찍는다.

## 🔴 이 자의 눈이 먼 자리 — **래스터는 글자를 못 센다**

글자 pt 는 PDF **텍스트 레이어**에서 읽는다. 그런데 원본에 **이미지로 박힌** 그림
(`native_xref`)은 라벨이 그 비트맵 안에 있어 텍스트 레이어에 아예 없다. 실측하면
벡터 8/8 에서 글자가 나오고 래스터 45/45 에서 안 나온다 — 그건 「글자가 없다」가 아니라
**「이 방법으로는 못 본다」**다. 그래서 래스터는 `글자판정 = "못 본다(래스터)"` 로 찍고,
대신 **인쇄 해상도**(px / 인쇄 폭)와 대조 시트를 남겨 눈으로 보게 한다.
(「없는 축은 변이시킬 수 없다」 — CLAUDE.md 2026-08-19.)

읽기만 한다. DB·지면·`public/figures` 를 안 건드린다.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts/qa/reports/figure-rect-ledger.json"
OUT = ROOT / "scripts/qa/reports/figure-tiny-inspect.json"
REPORTS = ROOT / "scripts/qa/reports"
CAP_MM = 70.0

# span 이 그림 칸 안에 있다고 볼 겹침 비율. 발문 마지막 줄이 칸에 살짝 걸치는 일이
# 있어 절반은 넘어야 그림 라벨로 센다.
INSIDE_RATIO = 0.6

# 축에 나란한 **곧은 선**은 폭·높이 중 하나가 정확히 0이다. 넓이로 나누면 그런 것이
# 전부 0이 되어 조용히 버려진다 — 이 저장소가 이미 데인 자리다(fitz.Rect.is_empty,
# CLAUDE.md 2026-08-19). 그래서 축마다 최소 두께를 준 뒤 견준다.
FLAT_EPS = 0.5  # pt


def overlap_ratio(a, b) -> float:
    """a 가 b 와 겹치는 넓이 / a 의 넓이. 곧은 선(넓이 0)도 세어진다."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    if ax1 - ax0 < FLAT_EPS:
        mid = (ax0 + ax1) / 2
        ax0, ax1 = mid - FLAT_EPS / 2, mid + FLAT_EPS / 2
    if ay1 - ay0 < FLAT_EPS:
        mid = (ay0 + ay1) / 2
        ay0, ay1 = mid - FLAT_EPS / 2, mid + FLAT_EPS / 2
    w = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    h = max(0.0, min(ay1, by1) - max(ay0, by0))
    return (w * h) / ((ax1 - ax0) * (ay1 - ay0))


def open_page(row, doc_cache):
    import pymupdf

    src = row["source_pdf"]
    doc = doc_cache.get(src)
    if doc is None:
        doc = pymupdf.open(src)
        doc_cache[src] = doc
    return doc[row["page_index0"]]


def inspect(row, doc_cache):
    page = open_page(row, doc_cache)
    rect = row["rect_pt"]

    sizes, texts = [], []
    for block in page.get_text("rawdict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if overlap_ratio(span["bbox"], rect) < INSIDE_RATIO:
                    continue
                text = span.get("text")
                if text is None:
                    text = "".join(c.get("c", "") for c in span.get("chars", []))
                if not text.strip():
                    continue
                sizes.append(round(float(span["size"]), 2))
                texts.append(text.strip())

    strokes = sum(
        1
        for d in page.get_drawings()
        if overlap_ratio(tuple(d["rect"]), rect) >= INSIDE_RATIO
    )
    return sizes, texts, strokes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=float, default=15.0, help="이 mm 미만만 본다")
    ap.add_argument("--sheet", action="store_true", help="대조 시트 PNG 도 만든다")
    ap.add_argument(
        "--context", type=int, default=0, help="가장 작은 N장의 원본 지면을 뜬다"
    )
    args = ap.parse_args()

    if not LEDGER.is_file():
        print(f"원장이 없다: {LEDGER}")
        print("  그림벡터 트랙의 산출물이다. 없으면 이 조사는 못 한다.")
        sys.exit(1)

    rows = json.loads(LEDGER.read_text(encoding="utf-8"))["행"]
    picked = sorted(
        (
            (min(CAP_MM, r["width_mm"]), r)
            for r in rows
            if r.get("width_mm") and min(CAP_MM, r["width_mm"]) < args.limit
        ),
        key=lambda t: t[0],
    )
    print(f"원장 {len(rows):,}행 · {args.limit:g}mm 미만 {len(picked)}장\n")

    doc_cache: dict = {}
    out = []
    for new_mm, r in picked:
        px = r["current_px"]
        cur_mm = min(CAP_MM, px[0] / 96 * 25.4)
        shrink = new_mm / r["width_mm"]  # 상한에 걸리면 원본보다 작아진다
        sizes, texts, strokes = inspect(r, doc_cache)
        raster = bool(r.get("native_xref")) or r.get("kind") == "raster"
        rec = {
            "figure": r["figure"],
            "새 mm": round(new_mm, 2),
            "지금 mm": round(cur_mm, 1),
            "원본 mm": round(r["width_mm"], 2),
            "상한 축소": round(shrink, 3),
            "px": px,
            "증명": r["match"],
            "kind": r.get("kind"),
            # 인쇄 해상도 — 새 폭으로 그렸을 때 1인치에 몇 점이 들어가나.
            "인쇄 dpi": round(px[0] / (new_mm / 25.4)),
            "글자판정": ("못 본다(래스터)" if raster and not sizes else "쟀다"),
            "글자 수": len(sizes),
            "지면 최소 pt": round(min(sizes) * shrink, 2) if sizes else None,
            "지면 중앙 pt": (
                round(statistics.median(sizes) * shrink, 2) if sizes else None
            ),
            "획": strokes,
            "글자": texts[:12],
        }
        out.append(rec)
        if sizes:
            label = f"글자 {len(sizes):3d} · 지면 최소 {rec['지면 최소 pt']}pt"
        elif raster:
            label = f"글자 못 본다(래스터) · 인쇄 {rec['인쇄 dpi']}dpi"
        else:
            label = f"벡터인데 글자 0 · 획 {strokes}"
        print(f"  {new_mm:5.2f}mm  {r['figure']:22s} (지금 {cur_mm:5.1f}mm)  {label}")

    if args.context:
        dump_context(picked[: args.context], doc_cache)
    for doc in doc_cache.values():
        doc.close()

    REPORTS.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"문턱mm": args.limit, "행": out}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"\n  -> {OUT.relative_to(ROOT)}")
    summarize(out)
    if args.sheet:
        make_sheet(out)


def summarize(out) -> None:
    """**분모를 먼저 찍는다** — 「글자 0장」이 「글자가 없다」로 읽히면 안 된다."""
    measured = [r for r in out if r["글자판정"] == "쟀다"]
    blind = [r for r in out if r["글자판정"] != "쟀다"]
    print(f"\n  글자를 **잰** 그림 {len(measured)}/{len(out)}")
    if measured:
        mins = sorted(r["지면 최소 pt"] for r in measured)
        print(
            f"    지면에서의 최소 글자 — 최소 {mins[0]:.2f}pt · 중앙 "
            f"{statistics.median(mins):.2f}pt · 최대 {mins[-1]:.2f}pt"
        )
        for lim in (5, 6, 7):
            print(f"    {lim}pt 미만 {sum(1 for v in mins if v < lim)}장")
    print(f"  글자를 **못 본** 그림 {len(blind)}/{len(out)} — 라벨이 비트맵 안에 있다")
    if blind:
        dpis = sorted(r["인쇄 dpi"] for r in blind)
        print(
            f"    그 대신 인쇄 해상도 — 최소 {dpis[0]}dpi · 중앙 "
            f"{statistics.median(dpis):.0f}dpi"
        )
        print(f"    300dpi 미만 {sum(1 for v in dpis if v < 300)}장")
    caps = [r for r in out if r["상한 축소"] < 0.999]
    print(
        f"  원본보다 **작아지는** 그림(70mm 상한에 걸린 것) {len(caps)}/{len(out)}"
        " — 나머지는 원본 시험지와 같은 크기다"
    )


def dump_context(picked, doc_cache) -> None:
    """원본 지면을 그대로 떠서 그 칸이 정말 그 자리인가를 눈으로 보게 한다."""
    import pymupdf

    for new_mm, r in picked:
        page = open_page(r, doc_cache)
        rect = pymupdf.Rect(*r["rect_pt"])
        page.draw_rect(rect, color=(1, 0, 0), width=1.2)
        clip = pymupdf.Rect(
            max(0, rect.x0 - 120),
            max(0, rect.y0 - 90),
            min(page.rect.x1, rect.x1 + 120),
            min(page.rect.y1, rect.y1 + 90),
        )
        name = r["figure"].replace("/", "_").rsplit(".", 1)[0]
        out = REPORTS / f"figure-tiny-context-{name}.png"
        page.get_pixmap(clip=clip, dpi=200).save(out)
        print(f"  -> {out.relative_to(ROOT)}  ({new_mm:.2f}mm · 빨간 칸이 그 그림이다)")


def make_sheet(records) -> None:
    """지금 폭 / 새 폭을 **같은 배율(300dpi)**로 나란히 붙인 대조 시트."""
    from PIL import Image, ImageDraw

    DPI = 300
    per_mm = DPI / 25.4
    pad, gap, cols = 14, 10, 6
    cell_w = int(CAP_MM * per_mm / 2)
    tiles = []
    for rec in records:
        try:
            img = Image.open(ROOT / "public/figures" / rec["figure"]).convert("RGB")
        except OSError:
            continue
        pair = [
            img.resize(
                (
                    max(1, int(mm * per_mm)),
                    max(1, int(img.height / img.width * mm * per_mm)),
                ),
                Image.LANCZOS,
            )
            for mm in (rec["지금 mm"], rec["새 mm"])
        ]
        tiles.append((rec, pair))
    if not tiles:
        return

    row_h = max(max(p.height for p in pair) for _, pair in tiles) + 34
    rows_n = (len(tiles) + cols - 1) // cols
    sheet = Image.new(
        "RGB",
        (pad * 2 + cols * (cell_w * 2 + gap), pad * 2 + rows_n * (row_h + gap)),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    for i, (rec, pair) in enumerate(tiles):
        cx = pad + (i % cols) * (cell_w * 2 + gap)
        cy = pad + (i // cols) * (row_h + gap)
        draw.text((cx, cy), rec["figure"], fill="black")
        draw.text(
            (cx, cy + 11), f"{rec['지금 mm']}mm  ->  {rec['새 mm']}mm", fill="black"
        )
        sheet.paste(pair[0], (cx, cy + 26))
        sheet.paste(pair[1], (cx + cell_w, cy + 26))
        draw.line(
            [(cx + cell_w - 4, cy + 24), (cx + cell_w - 4, cy + row_h)],
            fill=(200, 200, 200),
        )
    out = REPORTS / "figure-tiny-sheet.png"
    sheet.save(out)
    print(f"  -> {out.relative_to(ROOT)}  (300dpi · 왼쪽 지금 / 오른쪽 새)")
    make_gallery(records)


def make_gallery(records) -> None:
    """**무엇인 그림인가**를 보는 판 — 크기를 맞춰 늘어놓는다.

    대조 시트(`make_sheet`)는 «얼마나 작아지나»를 보는 물건이라 작은 것이 정말 작게
    나온다. 그건 「이게 무슨 그림인가」를 못 보게 한다. 그래서 판정용으로 한 장 더 만든다 —
    여기서는 **크기를 일부러 맞춘다**(그러니 이 판으로 크기를 논하면 안 된다).
    """
    from PIL import Image, ImageDraw

    CELL, COLS, HDR = 190, 9, 16
    tiles = []
    for rec in records:
        try:
            img = Image.open(ROOT / "public/figures" / rec["figure"]).convert("RGB")
        except OSError:
            continue
        scale = CELL / max(img.width, img.height)
        tiles.append(
            (
                rec,
                img.resize(
                    (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
                    Image.LANCZOS,
                ),
            )
        )
    if not tiles:
        return
    rows_n = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new(
        "RGB",
        (COLS * (CELL + 8) + 8, rows_n * (CELL + HDR + 10) + 8),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    for i, (rec, img) in enumerate(tiles):
        cx = 8 + (i % COLS) * (CELL + 8)
        cy = 8 + (i // COLS) * (CELL + HDR + 10)
        draw.text((cx, cy), f"{rec['figure']} {rec['새 mm']}mm", fill="black")
        sheet.paste(img, (cx, cy + HDR))
        draw.rectangle(
            [cx - 1, cy + HDR - 1, cx + CELL, cy + HDR + CELL], outline=(220, 220, 220)
        )
    out = ROOT / "docs/design/mockups/figure-print-size-tiny.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"  -> {out.relative_to(ROOT)}  (크기를 **맞춰** 늘어놓은 판 — 무엇인지 보는 용도)")


if __name__ == "__main__":
    main()
