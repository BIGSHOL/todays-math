# -*- coding: utf-8 -*-
"""같은 자(effective_dpi)로 지금 그림 vs 300dpi 재크롭 전량을 견준다.

분모를 지킨다. 새 디렉터리에 있는 편만 옛에서도 센다 — 아직 안 자른 편을
섞으면 「좋아졌다」가 요행이 된다.
"""
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
OUT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "resolution-full.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def collect(root: Path, only: set[str] | None) -> list[dict]:
    rows = []
    broken = []
    for p in root.rglob("*"):
        if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            continue
        rel = p.relative_to(root).as_posix()
        group = rel.split("/", 1)[0]
        if only is not None and group not in only:
            continue
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception as exc:  # noqa: BLE001
            broken.append((rel, repr(exc)[:80]))
            continue
        rows.append({"path": rel, "w": w, "h": h, "dpi": round(effective_dpi(w), 1), "group": group})
    return rows, broken


def summarize(tag: str, rows: list[dict]) -> dict:
    n = len(rows)
    counts = Counter(bucket(r["dpi"]) for r in rows)
    low = sum(1 for r in rows if r["dpi"] < 150)
    widths = sorted(r["w"] for r in rows) if rows else [0]
    print(f"\n[{tag}] {n}장 · 150 미만 {low}" + (f" ({100*low/n:.1f}%)" if n else ""))
    for name in [
        "96 (작아서 확대 안 됨)",
        "100~150 (거칠다)",
        "150~200",
        "200~300",
        "300 이상",
    ]:
        k = counts.get(name, 0)
        pct = f"{100*k/n:5.1f}%" if n else "  n/a"
        print(f"  {k:6}  {pct}  {name}")
    if rows:
        print(f"  가로px 최소 {widths[0]} · 중앙 {widths[n//2]} · 최대 {widths[-1]}")
    return {
        "장수": n,
        "150미만": low,
        "150미만비율": round(100 * low / n, 1) if n else None,
        "버킷": dict(counts),
        "가로_최소": widths[0] if rows else None,
        "가로_중앙": widths[n // 2] if rows else None,
        "가로_최대": widths[-1] if rows else None,
    }


def main() -> None:
    new_groups = {p.name for p in NEW.iterdir() if p.is_dir()}
    print(f"새 디렉터리 그룹 {len(new_groups)} · 같은 자 effective_dpi")
    old, old_b = collect(OLD, new_groups)
    new, new_b = collect(NEW, None)
    s_old = summarize("지금 — 새 디렉터리에 있는 그룹만", old)
    s_new = summarize("300dpi PNG 전량", new)
    exam_old = [r for r in old if r["group"].isdigit()]
    exam_new = [r for r in new if r["group"].isdigit()]
    rpm_old = [r for r in old if r["group"] == "rpm"]
    rpm_new = [r for r in new if r["group"] == "rpm"]
    print("\n[기출만]")
    summarize("지금 기출(같은 편)", exam_old)
    summarize("300 기출", exam_new)
    print("\n[RPM만]")
    summarize("지금 RPM(같은 것)", rpm_old)
    summarize("300 RPM", rpm_new)
    OUT.write_text(
        json.dumps(
            {
                "자": "measure-figure-resolution.effective_dpi",
                "새그룹수": len(new_groups),
                "지금_같은그룹": s_old,
                "재크롭300": s_new,
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
