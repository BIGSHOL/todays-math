# -*- coding: utf-8 -*-
"""화질 개선 4가드. 판정은 버리는 쪽으로.

1. 되돌려 대조 — 개선본을 원본 크기로 줄여 견준다.
2. 획이 사라지지 않았나 — 원본 검은 자리가 개선본에서 비면 버린다.
3. 없던 것이 생기지 않았나 — 원본에 없던 검은 덩어리면 버린다.
4. 하나라도 걸리면 버린다.
"""
from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter, ImageStat

# 밝기 문턱. 문서 스캔에서 획은 이보다 어둡고 배경은 이보다 밝다.
DARK = 80
LIGHT = 200
# 되돌려 대조: 평균 절대차 (0~255). 이보다 크면 내용이 바뀐 것.
REVERT_MEAN = 12.0
# 사라진 획 / 새로 생긴 검은 픽셀 비율 (원본 픽셀 수 대비).
LOST_FRAC = 0.004
NEW_FRAC = 0.004


@dataclass(frozen=True)
class GuardResult:
    ok: bool
    reason: str
    revert_mean: float
    lost: int
    new: int
    pixels: int


def to_gray(im: Image.Image) -> Image.Image:
    return im.convert("L")


def revert_mean(src: Image.Image, out: Image.Image) -> float:
    """개선본을 원본 크기로 줄여 평균 절대차."""
    a = to_gray(src)
    b = to_gray(out).resize(a.size, Image.Resampling.BILINEAR)
    diff = ImageChops.difference(a, b)
    return float(ImageStat.Stat(diff).mean[0])


def _count_white(im: Image.Image) -> int:
    # 0/255 마스크에서 흰 픽셀 수.
    return int(im.histogram()[255])


def lost_and_new(src: Image.Image, out: Image.Image) -> tuple[int, int, int]:
    a = to_gray(src)
    b = to_gray(out).resize(a.size, Image.Resampling.NEAREST)
    n = a.size[0] * a.size[1]
    a_dark = a.point(lambda v: 255 if v <= DARK else 0)
    a_light = a.point(lambda v: 255 if v >= LIGHT else 0)
    b_dark = b.point(lambda v: 255 if v <= DARK else 0)
    b_light = b.point(lambda v: 255 if v >= LIGHT else 0)
    lost = _count_white(ImageChops.multiply(a_dark, b_light))
    new = _count_white(ImageChops.multiply(a_light, b_dark))
    return lost, new, n


def judge(src: Image.Image, out: Image.Image) -> GuardResult:
    rm = revert_mean(src, out)
    lost, new, n = lost_and_new(src, out)
    if rm > REVERT_MEAN:
        return GuardResult(False, f"되돌려 대조 {rm:.2f} > {REVERT_MEAN}", rm, lost, new, n)
    if n and lost / n > LOST_FRAC:
        return GuardResult(False, f"사라진 획 {lost}/{n}", rm, lost, new, n)
    if n and new / n > NEW_FRAC:
        return GuardResult(False, f"새 검은 픽셀 {new}/{n}", rm, lost, new, n)
    return GuardResult(True, "통과", rm, lost, new, n)


def enhance_gray(src: Image.Image) -> Image.Image:
    """잡음 감소 + 약한 선명. 다시 그리지 않는다. PIL 만 쓴다."""
    g = to_gray(src)
    # 점잡음 — 3x3 중앙값. 가는 선은 한 픽셀짜리가 지워질 수 있어 가드가 막는다.
    den = g.filter(ImageFilter.MedianFilter(size=3))
    # 약하게 다시 또렷하게. 반경·비율을 키우면 링잉이 생긴다.
    sharp = den.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=3))
    return sharp


def midgray_frac(im: Image.Image) -> float:
    """중간 회색 비율(번짐). 흰·검이 아닌 픽셀 / 전체."""
    g = to_gray(im)
    hist = g.histogram()
    mid = sum(hist[41:220])
    n = g.size[0] * g.size[1]
    return mid / n if n else 0.0


def speckle_strength(im: Image.Image) -> float:
    """점잡음 세기: 3x3 중앙값과의 평균 절대차."""
    g = to_gray(im)
    med = g.filter(ImageFilter.MedianFilter(size=3))
    diff = ImageChops.difference(g, med)
    return float(ImageStat.Stat(diff).mean[0])
