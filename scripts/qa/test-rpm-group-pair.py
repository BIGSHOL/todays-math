# -*- coding: utf-8 -*-
"""무리 짝짓기 검수 시트가 켠 **네 가지 옵트인**을 합성 지면으로 시험한다.

    python scripts/qa/test-rpm-group-pair.py

`crop-rpm-from-pdf.py` 는 RPM 회수분 280건의 좌표를 흔들지 않으려고 새 동작을 전부
**꺼짐 기본**으로 넣는다. 그러면 「켜면 정말 달라지나 · 끄면 정말 그대로인가」를
누가 봐 주는가 — 여기서 본다. 네 가지 다 **양방향**으로 잰다.

| 옵트인 | 왜 켜야 했나 (실측) |
|---|---|
| `thin_pt` | 곧은 선은 `is_empty` 다 — 1-2 p11 `[0030~0033]` 의 가로 직선 216.6~301.9pt<br>가 통째로 안 보여 사람이 그린 네모가 222.8~295.0 으로 **줄어들며 선을 잘랐다** |
| `bound` | 사람이 그린 네모는 «찾을 자리»가 아니라 **울타리**다. ±`BOX_BLEED`(60pt) 로<br>자라면 격자 무리에서 옆 칸을 끌고 온다 (2-2 p41 `0198` 이 배지에 물렸다) |
| `min_size` | 한 줄짜리 그림은 원래 낮다 — 1-2 p9 의 반직선 `A B C` 는 83×12.6pt 라<br>기본 문턱(30×20)에 걸린다 |
| `drop_inside_text` | 글자가 그림을 감싸고 흐르면 거꾸로 걸린다 — 2-2 p41 `0201` 은 치수<br>라벨이 한 글자 블록으로 묶여 평행사변형 획 12개를 **전부** 삼켰다 |

⚠️ **가드는 망가뜨려 봐야 가드인 줄 안다**(CLAUDE.md 2026-08-18).
   변이 시험은 `scripts/qa/mutate-rpm-group-pair.sh` 에 있다.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_s = importlib.util.spec_from_file_location(
    "croprpm", _ROOT / "figure" / "crop-rpm-from-pdf.py"
)
crop = importlib.util.module_from_spec(_s)
_s.loader.exec_module(crop)

_s2 = importlib.util.spec_from_file_location(
    "pairsheet", _ROOT / "figure" / "sheet-rpm-group-pair.py"
)
sheet_mod = importlib.util.module_from_spec(_s2)
_s2.loader.exec_module(sheet_mod)

W, H = 595.0, 842.0
KO = "korea-s"
FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  OK  {name}")
    else:
        FAILS.append(name)
        print(f"  --  {name}  {detail}")


def _page(draw) -> tuple[fitz.Document, fitz.Page]:
    doc = fitz.open()
    page = doc.new_page(width=W, height=H)
    draw(page)
    return doc, page


# ─────────────────────────────────────────────────────────────────────────
def t_thin_pt() -> None:
    """두께 0인 곧은 선 — 끄면 안 보이고 켜면 보인다."""
    print("\n-- 곧은 선은 `is_empty` 다 --")

    def draw(p: fitz.Page) -> None:
        # 축에 나란한 선만 그린다. 폭 또는 높이가 정확히 0이라 `Rect.is_empty` 가 참.
        p.draw_line((100, 300), (240, 300), width=0.6)
        p.draw_line((170, 240), (170, 300), width=0.6)
        p.insert_text((96, 312), "A", fontsize=9)
        p.insert_text((236, 312), "B", fontsize=9)

    doc, page = _page(draw)
    box = fitz.Rect(90, 230, 250, 320)
    off = crop.figure_rect(page, box, "", thin_pt=0.0, min_size=(8.0, 8.0))
    on = crop.figure_rect(page, box, "", thin_pt=0.5, min_size=(8.0, 8.0))
    check("끄면 곧은 선을 못 본다 (예전 그대로)", off is None, f"={off}")
    check("켜면 곧은 선을 본다", on is not None, f"={on}")
    if on is not None:
        check("켜면 선 양끝을 다 담는다", on.x0 <= 100.5 and on.x1 >= 239.5,
              f"={[round(v, 1) for v in on]}")
    doc.close()


def t_bound() -> None:
    """울타리 — 준 네모 밖으로는 한 pt 도 안 나간다."""
    print("\n-- 사람이 그린 네모는 울타리다 --")

    def draw(p: fitz.Page) -> None:
        p.draw_rect(fitz.Rect(120, 260, 200, 320), width=0.8)   # 내 그림
        # 울타리 **경계에 걸친** 라벨. 실측 2-2 p41 `0198` 이 이 모양이다 —
        # 치수 `7 cm` 가 93.2 에서 시작하는데 울타리는 94.3 이었다. 라벨 되찾기·완비
        # 검사는 `bleed` 만 보므로 걸친 것은 **통째로 삼켜져** 울타리를 넘는다.
        # (아예 밖에 있는 라벨은 `bleed & bound` 에서 이미 안 보이므로 이 자리를
        #  안 만든다 — 그런 지면으로 시험하면 클램프가 초록으로 남는다.)
        p.insert_text((200, 292), "y cm", fontname=KO, fontsize=9)

    doc, page = _page(draw)
    box = fitz.Rect(115, 255, 205, 325)
    free = crop.figure_rect(page, box, "", min_size=(8.0, 8.0))
    fence = crop.figure_rect(page, box, "", bound=box, min_size=(8.0, 8.0))
    unclamped = crop.figure_rect(page, box, "", bound=None, min_size=(8.0, 8.0))
    check("울타리가 없으면 ±BOX_BLEED 까지 자란다", free is not None and free.x1 > 205,
          f"={None if free is None else [round(v, 1) for v in free]}")
    check("걸친 라벨은 울타리를 넘어서까지 삼켜진다 (클램프가 없으면)",
          unclamped is not None and unclamped.x1 > 205,
          f"={None if unclamped is None else [round(v, 1) for v in unclamped]}")
    check("울타리를 주면 그 밖으로 안 나간다",
          fence is not None and box.contains(fence),
          f"={None if fence is None else [round(v, 1) for v in fence]}")
    doc.close()


def t_min_size() -> None:
    """한 줄짜리 그림 — 기본 문턱은 거르고, 낮춘 문턱은 살린다."""
    print("\n-- 한 줄짜리 그림은 원래 낮다 --")

    def draw(p: fitz.Page) -> None:
        p.draw_line((100, 300), (240, 300), width=0.6)
        p.draw_circle((120, 300), 1.2, width=0.6, fill=(0, 0, 0))
        p.draw_circle((200, 300), 1.2, width=0.6, fill=(0, 0, 0))
        p.insert_text((116, 312), "A", fontsize=9)
        p.insert_text((196, 312), "B", fontsize=9)

    doc, page = _page(draw)
    box = fitz.Rect(90, 285, 250, 320)
    big = crop.figure_rect(page, box, "", thin_pt=0.5)                      # 기본 (30,20)
    small = crop.figure_rect(page, box, "", thin_pt=0.5, min_size=(8.0, 8.0))
    check("기본 문턱(30×20)은 한 줄짜리를 거른다", big is None, f"={big}")
    check("문턱을 낮추면 살린다", small is not None, f"={small}")
    if small is not None:
        check("한 줄짜리는 정말 낮다 (20pt 미만)", small.height < 20,
              f"height={small.height:.1f}")
    doc.close()


def t_inside_text() -> None:
    """글자가 그림을 감싸고 흐르면 획이 «글자 속»으로 버려진다."""
    print("\n-- 글자가 그림을 감싸고 흐를 때 --")

    def draw(p: fitz.Page) -> None:
        # 치수 라벨 둘이 **한 글자 블록**으로 묶이고, 그 블록이 그림을 통째로 덮는다.
        # 실제 지면(2-2 p41 `0201`)이 이 모양이다 — 발문·라벨이 그림을 감싸고 흐른다.
        p.insert_text((240, 308), "y cm", fontname=KO, fontsize=9)
        p.insert_text((150, 318), "12 cm", fontname=KO, fontsize=9)
        p.draw_line((165, 302), (265, 302), width=0.8)
        p.draw_line((165, 302), (175, 317), width=0.8)
        p.draw_line((265, 302), (275, 317), width=0.8)
        p.draw_line((175, 317), (275, 317), width=0.8)

    doc, page = _page(draw)
    box = fitz.Rect(150, 296, 285, 322)
    blocks = [
        fitz.Rect(*b["bbox"])
        for b in page.get_text("rawdict").get("blocks", [])
        if b.get("type") == 0
    ]
    covers = any(b.x0 <= 166 and b.x1 >= 274 and b.y0 <= 303 and b.y1 >= 316
                 for b in blocks)
    check("지면이 «글자 블록이 그림을 덮는» 자리를 만든다", covers,
          f"blocks={[[round(v, 1) for v in b] for b in blocks]}")
    dropped = crop.figure_rect(page, box, "", thin_pt=0.5, min_size=(8.0, 8.0))
    kept = crop.figure_rect(page, box, "", thin_pt=0.5, min_size=(8.0, 8.0),
                            drop_inside_text=False)
    check("기본은 «글자 속» 획을 버린다 (분수 가로줄 가드)", dropped is None,
          f"={dropped}")
    check("울타리를 그은 자리에서는 안 버린다", kept is not None, f"={kept}")
    doc.close()


def t_blob_merge() -> None:
    """격자 무리는 축을 못 정하므로 두 축의 덩어리를 **합쳐서** 보여 준다."""
    print("\n-- 두 축의 덩어리를 겹치면 하나로 --")
    row = {
        "덩어리y": [[10, 10, 60, 60], [10, 100, 60, 150]],
        # 같은 그림이 다른 축에서 조금 다르게 잘린 것 — 하나로 봐야 한다.
        "덩어리x": [[12, 11, 58, 59], [200, 10, 260, 60]],
    }
    got = sheet_mod.blob_boxes(row)
    check("겹치는 것은 하나로 본다 (번호가 둘이면 사람이 헷갈린다)", len(got) == 3,
          f"={got}")
    check("위→아래, 같으면 왼→오른 차례",
          got == sorted(got, key=lambda b: (round(b[1], 0), b[0])), f"={got}")
    check("더 큰 쪽을 남긴다", [10, 10, 60, 60] in got, f"={got}")


def t_emit_refuses() -> None:
    """판정이 하나라도 없으면 계획을 내지 않는다."""
    print("\n-- 조용히 빼지 않는다 --")
    sheet = {"목록": [{"소문항": [
        {"id": "a", "대상": True}, {"id": "b", "대상": True}, {"id": "c"},
    ]}]}
    check("안 적힌 대상을 집어낸다",
          sheet_mod.missing_decisions(sheet, {"a": {}}) == ["b"],
          f"={sheet_mod.missing_decisions(sheet, {'a': {}})}")
    check("대상이 아닌 행은 안 센다",
          sheet_mod.missing_decisions(sheet, {"a": {}, "b": {}}) == [],
          f"={sheet_mod.missing_decisions(sheet, {'a': {}, 'b': {}})}")


def t_decision_covers_targets() -> None:
    """**조용히 빼지 않는다** — 시트의 대상이 판정에 하나도 안 빠져야 한다."""
    print("\n-- 판정이 대상 전량을 덮나 --")
    sheet_p = _ROOT / "qa" / "reports" / "rpm-pair-sheet.json"
    dec_p = _ROOT / "qa" / "reports" / "rpm-pair-decision.json"
    if not (sheet_p.exists() and dec_p.exists()):
        print("  ..  시트/판정 파일이 없다 — 건너뛴다")
        return
    sheet = json.loads(sheet_p.read_text(encoding="utf-8"))
    dec = json.loads(dec_p.read_text(encoding="utf-8"))["판정"]
    targets = [m["id"] for g in sheet["목록"] for m in g["소문항"] if m.get("대상")]
    missing = [t for t in targets if t not in dec]
    check(f"대상 {len(targets)}건이 전부 판정돼 있다", not missing, f"빠짐={missing[:5]}")
    check("판정마다 «왜» 가 적혀 있다",
          all(len(v.get("왜", "")) >= 10 for v in dec.values()),
          f"짧은 것={[k for k, v in dec.items() if len(v.get('왜', '')) < 10][:3]}")
    picks = [v for v in dec.values() if "덩어리" in v]
    by_id = {m["id"]: g for g in sheet["목록"] for m in g["소문항"]}
    bad = [
        k for k, v in dec.items()
        if "덩어리" in v and not (1 <= int(v["덩어리"]) <= len(by_id[k]["덩어리"]))
    ]
    check(f"«덩어리 N» {len(picks)}건이 전부 시트의 번호 범위 안", not bad, f"={bad[:3]}")


def main() -> None:
    t_thin_pt()
    t_bound()
    t_min_size()
    t_inside_text()
    t_blob_merge()
    t_emit_refuses()
    t_decision_covers_targets()
    print()
    if FAILS:
        print(f"실패 {len(FAILS)}: " + " · ".join(FAILS))
        raise SystemExit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
