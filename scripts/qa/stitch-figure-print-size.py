# -*- coding: utf-8 -*-
"""갈래별 갈무리를 지시서가 지정한 한 장으로 붙인다.

    python scripts/qa/stitch-figure-print-size.py

shot-figure-print-size.mjs 가 남긴 manifest.json 을 읽는다.
원장님이 서버 없이 볼 수 있게 `docs/design/mockups/figure-print-size-print.png`
한 장에 **요약 + 각 갈래의 첫 지면 쌍**(15mm 미만은 표도)을 세로로 붙인다.
"""
from __future__ import annotations

import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs/design/mockups/figure-print-size-shots"
OUT = ROOT / "docs/design/mockups/figure-print-size-print.png"

PAD = 24
GAP = 16
LABEL_H = 36
MAX_W = 1600
# 표까지 붙이는 갈래 — 이 변경의 유일한 위험이라 목록이 보여야 한다.
TABLE_BUCKETS = {"15mm 미만"}


def open_rgb(path: pathlib.Path) -> Image.Image | None:
    if not path.is_file():
        print(f"  없음: {path.name}")
        return None
    img = Image.open(path).convert("RGB")
    if img.width > MAX_W:
        h = int(img.height * MAX_W / img.width)
        img = img.resize((MAX_W, h), Image.LANCZOS)
    return img


def fit_pair(left: Image.Image, right: Image.Image | None, width: int) -> Image.Image:
    if right is None:
        canvas = Image.new("RGB", (width, left.height), "white")
        canvas.paste(left, (0, 0))
        return canvas
    scale = min(1.0, (width - GAP) / (left.width + right.width))
    a = left.resize(
        (max(1, int(left.width * scale)), max(1, int(left.height * scale))),
        Image.LANCZOS,
    )
    b = right.resize(
        (max(1, int(right.width * scale)), max(1, int(right.height * scale))),
        Image.LANCZOS,
    )
    h = max(a.height, b.height)
    canvas = Image.new("RGB", (width, h), "white")
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + GAP, 0))
    return canvas


def main() -> None:
    manifest_path = SHOTS / "manifest.json"
    if not manifest_path.is_file():
        print(f"manifest 가 없다: {manifest_path}")
        sys.exit(1)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    rows: list[tuple[str, pathlib.Path, pathlib.Path | None]] = []
    if manifest.get("summary"):
        rows.append(("요약 (실측 원장)", SHOTS / manifest["summary"], None))
    for entry in manifest.get("buckets", []):
        bucket = entry["bucket"]
        if entry.get("table") and bucket in TABLE_BUCKETS:
            rows.append((f"{bucket} 표", SHOTS / entry["table"], None))
        now = entry.get("now") or entry.get("papers") or []
        nxt = entry.get("next") or []
        # 같은 쪽끼리 붙인다 — 문서 순서로 4장을 찍으면 지금만 4장이 된다.
        pair_n = max(len(now), len(nxt), 1)
        for i in range(min(pair_n, 1 if bucket not in TABLE_BUCKETS else 2)):
            left = SHOTS / now[i] if i < len(now) else None
            right = SHOTS / nxt[i] if i < len(nxt) else None
            if left is None and right is None:
                continue
            if left is None:
                left, right = right, None
            rows.append((f"{bucket} — 지금 / 새 p.{i+1}", left, right))

    bands: list[tuple[str, Image.Image]] = []
    width = 900
    for label, left_path, right_path in rows:
        left = open_rgb(left_path)
        if left is None:
            continue
        right = open_rgb(right_path) if right_path else None
        width = max(width, min(MAX_W, left.width + (right.width + GAP if right else 0)))
        bands.append((label, fit_pair(left, right, width)))

    if not bands:
        print("붙일 갈무리가 없다")
        sys.exit(2)

    # 폭을 맞춘 뒤 한 번 더 — 앞에서 width 가 커졌을 수 있다.
    bands = [(label, fit_pair(img, None, width) if img.width != width else img) for label, img in bands]

    total_h = PAD + sum(img.height + LABEL_H + GAP for _, img in bands) + PAD
    sheet = Image.new("RGB", (width + PAD * 2, total_h), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("malgun.ttf", 18)
    except OSError:
        font = ImageFont.load_default()

    y = PAD
    for label, img in bands:
        draw.text((PAD, y + 6), label, fill=(20, 20, 20), font=font)
        y += LABEL_H
        sheet.paste(img, (PAD, y))
        y += img.height + GAP

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT, optimize=True)
    print(f"  {OUT.relative_to(ROOT)}  {sheet.size[0]}x{sheet.size[1]}  {len(bands)}절")


if __name__ == "__main__":
    main()
