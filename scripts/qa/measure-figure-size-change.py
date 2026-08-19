# -*- coding: utf-8 -*-
"""그림 크기 규칙을 «픽셀»에서 «원본 물리 폭(mm)»으로 바꾸면 **무엇이 얼마나 달라지나**.

    python scripts/qa/measure-figure-size-change.py

전후 비교 지면(`/dev/figure-print-size`)은 표본 6장이고, 그 mm 도 **가정값**이었다
(「우리가 200dpi 로 잘랐다」는 기록에서 환산). 여기서는 `그림벡터` 트랙이 만든
**실측 원장**(`scripts/qa/reports/figure-rect-ledger.json`)의 `width_mm` 을 쓴다 —
원본 PDF 를 다시 매핑해 그림마다 바이트·픽셀·겹쳐 대조로 증명한 값이다.

두 규칙:
  지금 = min(70mm, 파일 가로 px / 96 * 25.4)     ← 픽셀을 96dpi 로 읽는다
  새   = min(70mm, 원본 지면에서의 물리 폭 mm)

읽기만 한다. DB 도 지면도 안 건드린다.
"""
from __future__ import annotations

import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts/qa/reports/figure-rect-ledger.json"
CAP_MM = 70.0  # printGeometry.figureMaxWidth = 264.567px = 70mm


def main() -> None:
    if not LEDGER.is_file():
        print(f"원장이 없다: {LEDGER}")
        print("  `그림벡터` 트랙의 산출물이다. 없으면 이 측정은 못 한다.")
        sys.exit(1)

    rows = json.loads(LEDGER.read_text(encoding="utf-8"))["행"]
    cur, new, native = [], [], []
    skipped = {"mm 없음": 0, "픽셀 없음": 0}
    for r in rows:
        mm, px = r.get("width_mm"), r.get("current_px")
        if not mm:
            skipped["mm 없음"] += 1
            continue
        if not px or not isinstance(px, list) or not px[0]:
            skipped["픽셀 없음"] += 1
            continue
        cur.append(min(CAP_MM, px[0] / 96 * 25.4))
        new.append(min(CAP_MM, mm))
        native.append(r.get("native_xref"))

    n = len(cur)
    # 분모를 먼저 찍는다 — 「N장 통과」가 N이 전부인지 말해 주지 않는다.
    print(f"원장 {len(rows):,}행 · 잰 것 {n:,}장 · 뺀 것 {sum(skipped.values()):,}")
    for k, v in skipped.items():
        print(f"    뺌: {k} {v:,}")
    print()

    smaller = sum(1 for a, b in zip(cur, new) if b < a * 0.98)
    bigger = sum(1 for a, b in zip(cur, new) if b > a * 1.02)
    print(f"  작아진다  {smaller:6,} ({100 * smaller / n:4.1f}%)")
    print(f"  그대로    {n - smaller - bigger:6,} ({100 * (n - smaller - bigger) / n:4.1f}%)")
    print(f"  커진다    {bigger:6,} ({100 * bigger / n:4.1f}%)\n")

    ratio = sorted(b / a for a, b in zip(cur, new))
    q = lambda f: ratio[min(n - 1, int(n * f))]  # noqa: E731
    print("  [배율] 새 폭 / 지금 폭")
    for f, lab in [(0.05, "하위 5%"), (0.25, "25%"), (0.5, "중앙"), (0.75, "75%"), (0.95, "상위 5%")]:
        print(f"    {lab:>7}  x{q(f):.2f}")
    print()

    print("  [폭 분포]")
    for lab, arr in [("지금", cur), ("새", new)]:
        s = sorted(arr)
        cap = sum(1 for v in arr if v >= CAP_MM - 0.01)
        print(
            f"    {lab:>3}  중앙 {s[n // 2]:5.1f}mm · 25% {s[n // 4]:5.1f} · 75% {s[3 * n // 4]:5.1f}"
            f" · 최소 {s[0]:4.1f} · 70mm 상한 {cap:,}장 ({100 * cap / n:.1f}%)"
        )
    print()

    # 「작아져서 못 읽는다」가 이 변경의 유일한 위험이다. 세어서 찍는다.
    for lim in (10, 15, 20):
        a = sum(1 for v in cur if v < lim)
        b = sum(1 for v in new if v < lim)
        print(f"  {lim}mm 미만:  지금 {a:,}장 → 새 {b:,}장")
    print()

    for lab, want in [("네이티브", True), ("폴백", False)]:
        idx = [i for i in range(n) if native[i] is want]
        if not idx:
            continue
        rr = sorted(new[i] / cur[i] for i in idx)
        print(f"  {lab:>5} {len(idx):6,}장 · 배율 중앙 x{rr[len(rr) // 2]:.2f}")


if __name__ == "__main__":
    main()
