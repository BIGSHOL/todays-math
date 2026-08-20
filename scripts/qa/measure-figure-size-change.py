# -*- coding: utf-8 -*-
"""그림 크기 규칙을 «픽셀»에서 «원본 물리 폭(mm)»으로 바꾸면 **무엇이 얼마나 달라지나**.

    python scripts/qa/measure-figure-size-change.py

전후 비교 지면(`/dev/figure-print-size`)은 이 원장의 실측 mm 를 읽는다.
원장이 없으면 가정값으로 내려가지 않고 멈춘다.

두 규칙:
  지금 = min(70mm, 파일 가로 px / 96 * 25.4)     ← 픽셀을 96dpi 로 읽는다
  새   = min(70mm, 원본 지면에서의 물리 폭 mm)

읽기만 한다. DB 도 지면도 안 건드린다.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts/qa/reports/figure-rect-ledger.json"
CAP_MM = 70.0  # printGeometry.figureMaxWidth = 264.567px = 70mm

QUESTION_RE = re.compile(r"^(?P<stem>.*q\d+)(?:_\d+)?$")


def question_key(figure: str) -> str:
    directory, _, name = figure.rpartition("/")
    base = name.rsplit(".", 1)[0]
    if directory.startswith("rpm/"):
        return directory
    m = QUESTION_RE.match(base)
    return f"{directory}/{m.group('stem')}" if m else f"{directory}/{base}"


def main() -> None:
    if not LEDGER.is_file():
        print(f"원장이 없다: {LEDGER}")
        print("  `그림벡터` 트랙의 산출물이다. 없으면 이 측정은 못 한다.")
        sys.exit(1)

    rows = json.loads(LEDGER.read_text(encoding="utf-8"))["행"]
    cur, new, native, kept = [], [], [], []
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
        kept.append(r)

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

    # 바닥값 선택지의 대가. **결정하지 않는다** — 원장님이 정하신다.
    # 새 규칙의 인쇄 폭이 곧 원본 폭(상한 미적용)이므로, 바닥을 두면 그 장들은
    # 원본 시험지보다 **커진다.** 15mm 미만 53장은 상한에 걸린 것이 0장이다.
    print("\n  [바닥값 선택지 — 두면 몇 장이 원본보다 커지나]")
    print("    (결정은 안 한다. 새 규칙에서 그 mm 미만인 장 수 · 같은 칸 섞임.)")
    pairs = list(zip(cur, new, kept))
    by_item: dict[str, list[float]] = {}
    for _c, nxt, row in pairs:
        by_item.setdefault(question_key(row["figure"]), []).append(nxt)
    for floor in (10, 12, 15, 18, 20, 25):
        hit = [(c, nxt) for c, nxt, _ in pairs if nxt < floor]
        if not hit:
            print(f"    {floor:>3}mm  0장")
            continue
        grow = sorted(floor / nxt for _, nxt in hit)
        mixed = sum(
            1
            for sizes in by_item.values()
            if any(v < floor for v in sizes) and any(v >= floor for v in sizes)
        )
        items = sum(1 for sizes in by_item.values() if any(v < floor for v in sizes))
        print(
            f"    {floor:>3}mm  {len(hit):4d}장 · 문항 {items} · "
            f"같은 칸에 미만+이상 {mixed} · 확대 중앙 ×{grow[len(grow)//2]:.2f} · "
            f"최대 ×{grow[-1]:.2f}"
        )


if __name__ == "__main__":
    main()
