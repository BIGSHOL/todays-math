# -*- coding: utf-8 -*-
"""새 무작위 20 그림 스펙이 엔진에서 그려지는지 본다."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "figure"))
sys.path.insert(0, r"F:\시험지변환기")

from elementary import render_elementary  # noqa: E402
from core.figure_scene import render_figure_spec  # noqa: E402
from core.figure_quality import sanitize_svg  # noqa: E402

SPECS = json.loads(Path("scripts/qa/reports/cube-probe/rand2-specs.json").read_text(encoding="utf-8"))


def main() -> None:
    failed = []
    for name, spec in SPECS.items():
        try:
            if spec.get("version") == "elem-1":
                svg = render_elementary(spec)
            else:
                svg = render_figure_spec(spec)
            svg = sanitize_svg(svg)
        except Exception as exc:
            failed.append(f"{name}: {exc}")
            print("FAIL", name, exc)
            continue
        print("OK", name, "len", len(svg), "vb", svg[svg.find("viewBox"): svg.find("viewBox") + 40] if "viewBox" in svg else "")
    if failed:
        sys.exit(1)
    print("all", len(SPECS))


if __name__ == "__main__":
    main()
