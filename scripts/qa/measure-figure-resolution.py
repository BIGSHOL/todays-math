# -*- coding: utf-8 -*-
"""그림 해상도 **전수 검사** — 「지면에서 몇 DPI 로 나가는가」 (읽기 전용).

    python scripts/qa/measure-figure-resolution.py
    python scripts/qa/measure-figure-resolution.py --json scripts/qa/reports/figure-resolution.json
    python scripts/qa/measure-figure-resolution.py --dir public/figures-300

원장님 지시 2026-08-19: 「우리 그림 해상도가 낮은것 같은데 전수 검사해보고」.

## 「낮다」의 기준은 **지면**에서 온다

픽셀 수만 세면 「낮다」를 판정할 수 없다 — 같은 400px 도 20mm 로 나가면 508dpi,
70mm 로 나가면 145dpi 다. 그래서 실효 DPI 로 잰다.

지면 규칙(`printGeometry.ts` · `printOverflow.ts`)은 이렇다:
  · 인쇄 그림 폭 **상한 70mm** (`figureMaxWidth` = 264.567 CSS px = 70mm × 96/25.4)
  · 상한보다 넓으면 **줄여서** 70mm 로 넣고, 좁으면 **CSS px 그대로**(=96dpi) 놓는다

따라서
  · width >= 264.567px  →  70mm 로 나간다  →  dpi = width / 2.7559in
  · width <  264.567px  →  width/96 in 로 나간다  →  dpi = **96** (원본이 작을 뿐)

⚠️ 두 번째 줄이 요점이다. **265px 미만은 아무리 세도 96dpi 다** — 크게 인쇄되는 게
   아니라 작게 인쇄된다. 「해상도가 낮다」는 두 가지 뜻이 될 수 있으니 둘 다 센다:
     ㉠ 70mm 로 늘어나는데 픽셀이 모자란다 (거칠게 나간다)
     ㉡ 애초에 작아서 지면에서도 작다 (거칠지는 않지만 안 보인다)

인쇄물의 실용 하한은 보통 **150dpi**, 편안한 값은 **300dpi** 다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FIGURE_DIR = ROOT / "public" / "figures"

# 지면 상수 — `src/lib/printGeometry.ts` 의 `figureMaxWidth` 와 같은 값이어야 한다.
FIGURE_MAX_WIDTH_CSS_PX = 264.567
CSS_PX_PER_INCH = 96.0
MAX_PRINT_INCH = FIGURE_MAX_WIDTH_CSS_PX / CSS_PX_PER_INCH  # 2.7559in = 70mm


def effective_dpi(width_px: int) -> float:
    """지면에서 실제로 나가는 DPI. 상한보다 좁으면 원본 크기 그대로(=96dpi)."""
    if width_px >= FIGURE_MAX_WIDTH_CSS_PX:
        return width_px / MAX_PRINT_INCH
    return CSS_PX_PER_INCH


def bucket(dpi: float) -> str:
    if dpi < 100:
        return "96 (작아서 확대 안 됨)"
    if dpi < 150:
        return "100~150 (거칠다)"
    if dpi < 200:
        return "150~200"
    if dpi < 300:
        return "200~300"
    return "300 이상"


def main() -> None:
    fig_dir = FIGURE_DIR
    if "--dir" in sys.argv:
        fig_dir = ROOT / sys.argv[sys.argv.index("--dir") + 1]
    if not fig_dir.is_dir():
        print(f"그림 디렉터리가 없다: {fig_dir}")
        sys.exit(1)

    rows = []
    broken = []
    for path in sorted(fig_dir.rglob("*")):
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            continue
        try:
            with Image.open(path) as im:
                w, h = im.size
        except Exception as exc:  # 손상 파일도 «세어서 찍는다» — 조용히 빼지 않는다.
            broken.append((str(path.relative_to(ROOT)), repr(exc)[:80]))
            continue
        rel = path.relative_to(fig_dir).as_posix()
        rows.append(
            {
                "path": rel,
                "w": w,
                "h": h,
                "dpi": round(effective_dpi(w), 1),
                "group": rel.split("/", 1)[0],
            }
        )

    if not rows:
        print("그림이 없다.")
        sys.exit(1)

    rows.sort(key=lambda r: r["dpi"])
    n = len(rows)

    def pct(k: int) -> str:
        return f"{100 * k / n:5.1f}%"

    print(f"  그림 {n}장 · 열지 못한 파일 {len(broken)}장")
    print(f"  지면 규칙: 폭 상한 70mm — 넘으면 줄이고, 좁으면 원본 크기 그대로(96dpi)\n")

    counts: dict[str, int] = {}
    for r in rows:
        counts[bucket(r["dpi"])] = counts.get(bucket(r["dpi"]), 0) + 1
    print("  [지면 실효 DPI]")
    for name in [
        "96 (작아서 확대 안 됨)",
        "100~150 (거칠다)",
        "150~200",
        "200~300",
        "300 이상",
    ]:
        k = counts.get(name, 0)
        print(f"  {k:6}  {pct(k)}  {name}")

    widths = sorted(r["w"] for r in rows)
    q = lambda p: widths[min(n - 1, int(n * p))]  # noqa: E731
    print(
        f"\n  [원본 가로 픽셀] 최소 {widths[0]} · 25% {q(0.25)} · 중앙 {q(0.5)}"
        f" · 75% {q(0.75)} · 최대 {widths[-1]}"
    )

    # 무리별 — 출처가 다르면 손볼 방법도 다르다(RPM 오려내기 vs 시험지 오려내기).
    groups: dict[str, list[float]] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r["dpi"])
    print(f"\n  [무리별] (150dpi 미만 = 거칠거나 작다)")
    for name, dpis in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:12]:
        low = sum(1 for d in dpis if d < 150)
        print(
            f"  {len(dpis):6}장  {100 * low / len(dpis):5.1f}% 가 150 미만  {name}"
        )

    print(f"\n  [가장 낮은 10장]")
    for r in rows[:10]:
        print(f"  {r['dpi']:7.1f}dpi  {r['w']}x{r['h']}  {r['path']}")

    if broken:
        print(f"\n  [열지 못한 파일] {len(broken)}장")
        for p, e in broken[:10]:
            print(f"  {p}  {e}")

    if "--json" in sys.argv:
        out = ROOT / sys.argv[sys.argv.index("--json") + 1]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(
                {
                    "기준": "지면 폭 상한 70mm — printGeometry.figureMaxWidth",
                    "장수": n,
                    "열지못함": broken,
                    "그림": rows,
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"\n  → {out}")


if __name__ == "__main__":
    main()
