# -*- coding: utf-8 -*-
"""바꿔치기 대상을 «픽셀이 실제로 늘어난 것»으로 좁히면 무엇을 얻고 무엇을 치르나.
읽기만 한다 — 아무것도 안 쓴다."""
import sys, pathlib
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

WT = pathlib.Path(r"C:/Users/user/orca/workspaces/testautocreator/그림화질")
OLD, NEW = WT / "public/figures", WT / "public/figures-300"
MAXW = 264.567

def dpi(w):
    return w / (MAXW / 96.0) if w >= MAXW else 96.0

grew = same = missing = broken = 0
b_old_grew = b_new_grew = b_old_same = b_new_same = 0
low_old = low_new = low_swapsubset = 0
n = 0
for p in NEW.rglob("*"):
    if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        continue
    rel = p.relative_to(NEW)
    # 옛 파일은 확장자가 다를 수 있다(JPEG→PNG). 어간으로 찾는다.
    cands = list((OLD / rel.parent).glob(rel.stem + ".*")) if (OLD / rel.parent).is_dir() else []
    if not cands:
        missing += 1
        continue
    q = cands[0]
    try:
        with Image.open(p) as im: nw = im.size[0]
        with Image.open(q) as im: ow = im.size[0]
    except Exception:
        broken += 1
        continue
    n += 1
    low_old += dpi(ow) < 150
    low_new += dpi(nw) < 150
    if nw > ow:
        grew += 1
        b_old_grew += q.stat().st_size; b_new_grew += p.stat().st_size
        low_swapsubset += dpi(nw) < 150
    else:
        same += 1
        b_old_same += q.stat().st_size; b_new_same += p.stat().st_size
        low_swapsubset += dpi(ow) < 150

mb = lambda b: b / 1024 / 1024
print(f"짝지은 것 {n}장 · 옛 파일 못 찾음 {missing} · 열지 못함 {broken}")
print(f"  가로가 늘어난 것  {grew:6}장  ({100*grew/n:.1f}%)")
print(f"  그대로/줄어든 것  {same:6}장  ({100*same/n:.1f}%)")
print()
print(f"[용량] 늘어난 것만: 옛 {mb(b_old_grew):7.1f}MB → 새 {mb(b_new_grew):7.1f}MB")
print(f"       그대로인 것: 옛 {mb(b_old_same):7.1f}MB → 새 {mb(b_new_same):7.1f}MB  (바꿔도 화질 이득 0)")
print(f"       전부 바꾸면 {mb(b_old_grew+b_old_same):7.1f}MB → {mb(b_new_grew+b_new_same):7.1f}MB")
print(f"       늘어난 것만 바꾸면          → {mb(b_new_grew+b_old_same):7.1f}MB")
print()
print(f"[150dpi 미만] 짝지은 {n}장 기준")
print(f"  지금            {100*low_old/n:5.1f}%")
print(f"  전부 바꾸면     {100*low_new/n:5.1f}%")
print(f"  늘어난 것만     {100*low_swapsubset/n:5.1f}%   ← 전부 바꾼 것과 같아야 정상")
