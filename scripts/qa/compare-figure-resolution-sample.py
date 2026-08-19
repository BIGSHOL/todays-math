# -*- coding: utf-8 -*-
"""같은 자(measure-figure-resolution.effective_dpi)로 10편 전후를 견준다."""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "measureres", ROOT / "scripts" / "qa" / "measure-figure-resolution.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
bucket = _mod.bucket
effective_dpi = _mod.effective_dpi

OLD = ROOT / "public" / "figures"
NEW = ROOT / "public" / "figures-300"
COST = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "cost10.json"
OUT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "cost10-resolution.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def rows_of(root: Path, eids: list[str]) -> list[dict]:
    rows = []
    broken = []
    for eid in eids:
        d = root / eid
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
                continue
            try:
                with Image.open(p) as im:
                    w, h = im.size
            except Exception as exc:  # noqa: BLE001
                broken.append((str(p), repr(exc)[:80]))
                continue
            rows.append(
                {
                    "path": f"{eid}/{p.name}",
                    "w": w,
                    "h": h,
                    "dpi": round(effective_dpi(w), 1),
                    "ext": p.suffix.lower(),
                }
            )
    return rows, broken


def summarize(tag: str, rows: list[dict]) -> dict:
    n = len(rows)
    counts = Counter(bucket(r["dpi"]) for r in rows)
    widths = sorted(r["w"] for r in rows) if rows else [0]
    low = sum(1 for r in rows if r["dpi"] < 150)
    print(f"\n[{tag}] {n}장 · 150 미만 {low} ({100*low/n:.1f}%)" if n else f"\n[{tag}] 0장")
    for name in [
        "96 (작아서 확대 안 됨)",
        "100~150 (거칠다)",
        "150~200",
        "200~300",
        "300 이상",
    ]:
        k = counts.get(name, 0)
        pct = f"{100*k/n:5.1f}%" if n else "  n/a"
        print(f"  {k:4}  {pct}  {name}")
    if rows:
        print(
            f"  가로px 최소 {widths[0]} · 중앙 {widths[len(widths)//2]} · 최대 {widths[-1]}"
        )
    return {
        "장수": n,
        "150미만": low,
        "150미만비율": round(100 * low / n, 1) if n else None,
        "버킷": dict(counts),
        "가로_최소": widths[0] if rows else None,
        "가로_중앙": widths[len(widths) // 2] if rows else None,
        "가로_최대": widths[-1] if rows else None,
    }


def main() -> None:
    eids = json.loads(COST.read_text(encoding="utf-8"))["편"]
    old, old_b = rows_of(OLD, eids)
    new, new_b = rows_of(NEW, eids)
    print("같은 자: measure-figure-resolution.effective_dpi · 지면 폭 상한 70mm")
    print(f"대상 편 {eids}")
    s_old = summarize("지금 public/figures 같은 10편", old)
    s_new = summarize("300dpi PNG public/figures-300 같은 10편", new)
    # 짝이 맞는 파일명(확장자 무시)의 가로 픽셀
    def key(r):
        return r["path"].rsplit(".", 1)[0]

    old_by = {key(r): r for r in old}
    new_by = {key(r): r for r in new}
    both = sorted(set(old_by) & set(new_by))
    grew = same = shrink = 0
    for k in both:
        dw = new_by[k]["w"] - old_by[k]["w"]
        if dw > 2:
            grew += 1
        elif dw < -2:
            shrink += 1
        else:
            same += 1
    print(f"\n이름 짝 {len(both)} · 가로 늘음 {grew} · 같음 {same} · 줄음 {shrink}")
    print(f"옛만 {len(set(old_by)-set(new_by))} · 새만 {len(set(new_by)-set(old_by))}")
    print(f"열지못함 옛 {len(old_b)} 새 {len(new_b)}")
    OUT.write_text(
        json.dumps(
            {
                "자": "scripts/qa/measure-figure-resolution.py · effective_dpi",
                "편": eids,
                "지금": s_old,
                "재크롭300": s_new,
                "짝": {"둘다": len(both), "늘음": grew, "같음": same, "줄음": shrink},
                "열지못함": {"옛": old_b, "새": new_b},
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
