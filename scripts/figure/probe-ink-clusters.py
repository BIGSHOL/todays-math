# -*- coding: utf-8 -*-
"""검수 시트의 한 행에서 **잉크 덩어리를 좌표째로** 늘어놓는다.

    python scripts/figure/probe-ink-clusters.py <id앞자리>

## 왜 이 도구인가

`--recut` 은 사람이 네모를 준다. 그런데 그 네모를 **렌더된 png 를 눈대중해서**
만들면 몇 pt 씩 어긋나고, 어긋난 칸은 지면에서 티가 잘 안 난다(2026-08-18
「잘린 그림은 지면에서 티가 안 난다」). 그래서 **PDF 가 들고 있는 좌표를 그대로**
읽어 고른다 — 눈은 「어느 덩어리인가」만 고르면 된다.

`crop-rpm-from-pdf` 의 재료를 그대로 쓴다(획·이미지 블록 · `largest_cluster`).
찾는 규칙을 여기서 다시 쓰지 않는다 — 쓰면 세는 쪽과 오리는 쪽이 갈라진다.

⚠️ 아무것도 안 바꾼다.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("croprpm", _HERE / "crop-rpm-from-pdf.py")
crop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crop)

SHEET = pathlib.Path("scripts/qa/reports/rpm-stem-sheet.json")
RESULTS = (
    "scripts/qa/reports/rpm-crop-plan-gated.json",
    "scripts/qa/reports/rpm-group-crop-plan.json",
)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("사용: python scripts/figure/probe-ink-clusters.py <id앞자리>")
    prefix = sys.argv[1]
    sheet = json.loads(SHEET.read_text(encoding="utf-8"))
    row = next((r for r in sheet["목록"] if r["externalId"].startswith(prefix)), None)
    if row is None:
        raise SystemExit(f"시트에 없는 id: {prefix}")

    it = None
    for plan_path in RESULTS:
        plan = {i["externalId"]: i for i in
                json.loads(pathlib.Path(plan_path).read_text(encoding="utf-8"))["목록"]}
        if row["externalId"] in plan:
            it = plan[row["externalId"]]
            break
    if it is None:
        raise SystemExit("계획에 없다")

    doc = pymupdf.open(it["pdf"])
    page = doc[int(it["page"]) - 1]
    box = pymupdf.Rect(*it["rect"]) & page.rect
    # 「오른쪽 그림」이면 오려내기와 같은 자리까지 넓혀서 본다.
    src = pymupdf.Rect(box)
    if row.get("축") == "오른쪽":
        edge = (page.rect.x1 - crop.WIDEN_RIGHT_MARGIN
                if box.x1 > crop.COLUMN_W else crop.COLUMN_W)
        if edge > box.x1 + 1:
            src = pymupdf.Rect(box.x0, box.y0, edge, box.y1) & page.rect
    elif row.get("축") == "아래":
        src = pymupdf.Rect(box.x0, box.y0, box.x1, min(box.y1 + 160, page.rect.y1))

    print(f"{row['externalId'][:13]}  {row['책']}  p{row['쪽']}  축 {row.get('축')}")
    print(f"  계획 상자 {[round(v, 1) for v in box]}  · 볼 자리 {[round(v, 1) for v in src]}")
    print(f"  지면 {[round(v, 1) for v in page.rect]}")

    raw = page.get_text("rawdict")
    page_area = page.rect.get_area()
    parts: list[tuple[str, pymupdf.Rect]] = []
    for b in raw.get("blocks", []):
        if b.get("type") == 0:
            continue
        r = pymupdf.Rect(*b["bbox"])
        if r.get_area() >= page_area * 0.7 or (r & src).is_empty:
            continue
        parts.append(("이미지", r))
    for d in page.get_drawings():
        r = pymupdf.Rect(d["rect"])
        if r.is_infinite or r.is_empty or r.get_area() >= page_area * 0.7:
            continue
        if (r & src).is_empty:
            continue
        parts.append(("획", r))

    if not parts:
        print("  잉크 덩어리가 없다")
        return

    # 겹치는 것끼리 묶는다 — 「어느 그림인가」는 덩어리 단위로 고른다.
    groups: list[pymupdf.Rect] = []
    kinds: list[dict[str, int]] = []
    for kind, r in parts:
        hit = None
        for i, g in enumerate(groups):
            grown = pymupdf.Rect(g.x0 - 3, g.y0 - 3, g.x1 + 3, g.y1 + 3)
            if not (grown & r).is_empty:
                hit = i
                break
        if hit is None:
            groups.append(pymupdf.Rect(r))
            kinds.append({kind: 1})
        else:
            groups[hit] |= r
            kinds[hit][kind] = kinds[hit].get(kind, 0) + 1
    # 한 번 더 합친다(사슬로 이어진 것).
    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                gi = pymupdf.Rect(groups[i].x0 - 3, groups[i].y0 - 3,
                                  groups[i].x1 + 3, groups[i].y1 + 3)
                if not (gi & groups[j]).is_empty:
                    groups[i] |= groups[j]
                    for k, v in kinds[j].items():
                        kinds[i][k] = kinds[i].get(k, 0) + v
                    del groups[j], kinds[j]
                    merged = True
                    break
            if merged:
                break

    order = sorted(range(len(groups)), key=lambda i: -groups[i].get_area())
    print(f"  덩어리 {len(groups)}개 (넓은 순)")
    for n, i in enumerate(order, 1):
        g = groups[i]
        txt = page.get_text("text", clip=g).replace("\n", " ").strip()
        print(f"   {n:2d}. [{g.x0:6.1f} {g.y0:6.1f} {g.x1:6.1f} {g.y1:6.1f}]"
              f"  {g.width:5.1f}×{g.height:5.1f}  {kinds[i]}"
              f"  글자: {txt[:44]!r}")


if __name__ == "__main__":
    main()
