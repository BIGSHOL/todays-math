# -*- coding: utf-8 -*-
"""가드를 망가뜨려 본다. 안 빨개지면 장식이다."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parents[1] / "figure"
sys.path.insert(0, str(HERE))
from enhance_guards import enhance_gray, judge  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def line_img() -> Image.Image:
    im = Image.new("L", (120, 80), 255)
    d = ImageDraw.Draw(im)
    d.line((10, 40, 110, 40), fill=0, width=1)
    d.line((60, 10, 60, 70), fill=0, width=1)
    d.text((14, 12), "A", fill=0)
    return im


def fail(msg: str) -> None:
    print("FAIL", msg)
    raise SystemExit(1)


def main() -> None:
    src = line_img()
    same = src.copy()
    g = judge(src, same)
    if not g.ok:
        fail(f"같은 그림이 버려졌다: {g.reason}")

    eaten = src.copy()
    d = ImageDraw.Draw(eaten)
    d.line((10, 40, 110, 40), fill=255, width=3)  # 가로획을 지움
    g = judge(src, eaten)
    if g.ok:
        fail("획을 지웠는데 통과했다")

    extra = src.copy()
    d = ImageDraw.Draw(extra)
    d.ellipse((20, 20, 50, 50), fill=0)  # 없던 검은 덩어리
    g = judge(src, extra)
    if g.ok:
        fail("새 덩어리가 통과했다")

    shifted = Image.new("L", src.size, 255)
    shifted.paste(src, (10, 8))
    g = judge(src, shifted)
    if g.ok:
        fail("내용을 밀어 옮겼는데 통과했다")

    # 개선기가 자기 가드를 통과하는가 (가는 선 픽스처)
    out = enhance_gray(src)
    g = judge(src, out)
    print(f"개선기 자가 검사: ok={g.ok} {g.reason} revert={g.revert_mean:.2f} lost={g.lost} new={g.new}")
    # 가는 1px 선은 중앙값에 지워질 수 있다 — 그때는 버리는 쪽이 맞다.
    # 여기서 통과/폐기를 강제하지 않고 숫자만 찍는다. 실데이터로 다시 본다.

    print("가드 변이 3개 빨강 · 동일본 초록")


if __name__ == "__main__":
    main()
