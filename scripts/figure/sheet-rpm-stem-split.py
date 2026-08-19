# -*- coding: utf-8 -*-
"""「본문방향으로도 못 가른 44건」 **검수 시트** — 사람이 보고 고르는 자리.

    python scripts/figure/sheet-rpm-stem-split.py            # 시트를 만든다
    python scripts/figure/sheet-rpm-stem-split.py --apply    # 판정이 「쓴다」인 것만 붙일 준비를 한다

## 왜 이 도구인가 — **네모 하나로 못 가르는 배치**

`crop-rpm-from-pdf.py --stem-split` 이 62건 중 18건을 되찾고 44건을 남겼다. 남은
사유를 세어 보니 **36건이 「벽이 지면 글자를 가로지른다」**였다. RPM 은 발문이 그림을
**감싸고 흐른다** — 마지막 줄이 그림 아래를 지나 더 멀리 가거나, 보기 줄이 그림
오른쪽까지 올라온다. 그런 배치에서는 그림을 담는 **어떤 네모에도** 발문 조각이 들어온다.
문턱을 옮겨서 될 일이 아니다.

그래서 여기서는 **하나만 푼다**: 벽을 세우는 데 쓴 증거는 그대로 두고,
「벽이 지면 글자를 가로지르면 버린다」를 **「가로지른 글자는 지운다」**로 바꾼다.

## ⚠️ 증거를 버리고 다시 찾지 마라 — 한 번 그렇게 했다가 되돌렸다

처음엔 이 스크립트가 **제 나름대로** 그림을 찾았다(상자 안 잉크 덩어리 중 가장 큰 것).
그랬더니 30건을 제안했는데 눈으로 보니 **소단원 머리띠**·**문항 번호 배지**·
**증명 빈칸 상자**·**보기 글상자**가 그림 자리에 앉아 있었다(실측 `748f`·`a032`·`a916`).
「본문이 말하는 자리」를 안 쓰면 그림이 어디인지 알 방법이 없다. 그래서 지금은
`crop-rpm-from-pdf.py` 의 **띠(`stem_text_bands`)와 벽(`stem_wall`)을 그대로 부른다** —
찾는 규칙은 한 곳뿐이고, 여기서 다른 것은 **완비 검사에서 지면 글자를 빼는 것 하나**다.

## 지운다 — 그런데 **무엇을** 지우는지가 전부다

「지우면 근거가 사라진다」(2026-08-16)는 교훈이 여기에도 걸린다. 그래서

- 원본 PDF 는 **건드리지 않는다.** 메모리에 연 사본에서 글자만 뺀 뒤 그림을 뜬다
  (`apply_redactions(text=REMOVE, graphics=NONE, images=NONE)` — 선·그림은 그대로 남고
  글자만 빠진다. 흰 사각형으로 덮으면 밑을 지나는 **그림 선까지** 덮인다).
- 지운 자리를 **좌표와 글자로** 시트에 남긴다. 무엇을 지웠는지 다시 볼 수 있어야 한다.
- 지울 대상은 **지면 글자뿐**이다(`span_boxes` 의 판정 — DB 본문에 있는 조각 ·
  선택지 번호 · 한글이 든 조각). 그림 라벨(`A` `16 cm` `110°`)은 셋 다 아니다.

## 그리고 **사람이 본다** — 이 시트가 그 자리다

이 스크립트가 내는 `0.png` 는 **그대로 붙을 파일**이다. 검수용으로 따로 그리지
않는다 — 따로 그리면 「본 것」과 「붙는 것」이 갈라지고, 갈라지면 같이 눈이 먼다.
옆에 `page.png`(지면 맥락 · 칸 빨강 · 지운 자리 파랑)를 같이 낸다.

판정은 `scripts/qa/reports/rpm-stem-sheet-decision.json` 에 **사유와 함께** 적는다.
`--apply` 는 「쓴다」인 것만 `public/figures/rpm/` 로 옮기고 붙이기용 결과를 낸다.
판정이 안 적힌 행이 하나라도 있으면 **멈춘다** — 조용히 빼지 않는다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import sys

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("croprpm", _HERE / "crop-rpm-from-pdf.py")
crop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crop)

RESULTS = (
    ("gated", "scripts/qa/reports/rpm-crop-result-gated.json",
     "scripts/qa/reports/rpm-crop-plan-gated.json"),
    ("group", "scripts/qa/reports/rpm-crop-result-group.json",
     "scripts/qa/reports/rpm-group-crop-plan.json"),
)
CONTENT = pathlib.Path("scripts/qa/reports/rpm-crop-content.json")
BOXES = pathlib.Path("scripts/qa/reports/rpm-question-boxes.json")
SHEET = pathlib.Path("scripts/qa/reports/rpm-stem-sheet.json")
SHOTS = pathlib.Path("scripts/qa/reports/rpm-stem-sheet")
DECISION = pathlib.Path("scripts/qa/reports/rpm-stem-sheet-decision.json")
APPLIED = pathlib.Path("scripts/qa/reports/rpm-crop-result-sheet.json")

#: 지운 자리가 칸의 이만큼을 넘으면 그림이 아니라 **문항을 오린 것**이다.
#: 문턱이 아니라 **사람에게 먼저 보여 줄 순서**를 정하는 값이다 — 넘으면 「막힘」으로
#: 표시해 두고, 최종 판정은 어차피 사람이 한다.
MASK_AREA_MAX = 0.30
#: **지운 것이 발문이면 그건 그림 칸이 아니라 문항 칸이다.** 오려내기의 「칸에 발문이
#: N자 들어왔다」와 **같은 자**(`STEM_INTRUSION_CHARS`)를 쓴다 — 그 검사가 «칸에
#: 들어온 발문»을 세는 자리에서, 여기서는 «지워 버린 발문»을 센다.
#: 61개 후보를 재 보니 분포가 **둘로 갈렸다**: 0~9자(30개, 라벨 옆 부스러기)와
#: 17~94자(19개, 문항을 통째로 오린 것). 문턱은 그 사이 빈 자리에 놓인다.
MASK_STEM_MAX = None   # crop.STEM_INTRUSION_CHARS 를 쓴다(아래 import 뒤 값 대입)
#: 지운 것 중 **선택지 번호**가 이만큼 넘게 있으면 「보기가 그림인 문항」이다.
#: 그건 문항을 통째로 오려 놓고 글자만 지운 꼴이라 못 쓴다.
MASK_CHOICE_MAX = 2
#: 인쇄된 문항 번호가 이만큼 안쪽이면 **같은 무리의 형제**로 본다. 무리 지면에서는
#: 형제의 좌표 상자가 공용 그림을 가로질러 놓인다(보고서 §5.1 실측).
SIBLING_GAP = 3
MASK_STEM_MAX = crop.STEM_INTRUSION_CHARS


def masked_figure(page, box: pymupdf.Rect, stem_key: str, avoid: list[pymupdf.Rect],
                  limit: pymupdf.Rect) -> tuple[pymupdf.Rect | None, list, str]:
    """벽 안에서 그림을 찾되, **지면 글자는 «자를 것»이 아니라 «지울 것»으로 본다.**

    `crop-rpm-from-pdf.figure_rect(limit=…)` 와 재료도 규칙도 같다. 둘이 다르다.

    1. 완비 검사(「아무것도 반으로 자르지 않는다」)에서 **지면 글자를 뺀다** — 그건
       자를 것이 아니라 **지울** 것이기 때문이다. 그림 재료(획·이미지·라벨)는 그대로
       검사한다. 그래서 **잘린 라벨은 여기서도 문항을 버린다.**
    2. **덩어리는 벽 안에서 고르고, 라벨은 벽 밖이라도 데려온다.** 벽은 지면 글자를
       막으려고 세운 것이라, 글자가 그림 **안으로** 들어온 배치에서는 벽이 그림을
       가른다 — 실측으로 34건 중 22건이 「그림 재료를 반으로 자른다」로 막혔다.
       벽의 몫을 「어느 덩어리인가」로 좁히고, 자라는 것은 `bleed` 까지 둔다.
       (벽을 아예 안 쓰면 소단원 머리띠·번호 배지가 그림 자리에 앉는다 — 이미 겪었다.)
    """
    raw = page.get_text("rawdict")
    page_area = page.rect.get_area()
    bleed = pymupdf.Rect(box.x0 - crop.BOX_BLEED, box.y0 - crop.BOX_BLEED,
                         box.x1 + crop.BOX_BLEED, box.y1 + crop.BOX_BLEED) & page.rect
    room = bleed & limit

    text_blocks = [pymupdf.Rect(*b["bbox"]) for b in raw.get("blocks", [])
                   if b.get("type") == 0 and not pymupdf.Rect(*b["bbox"]).is_empty]

    def inside_text(r: pymupdf.Rect) -> bool:
        for t in text_blocks:
            i = r & t
            if not i.is_empty and i.get_area() >= r.get_area() * 0.8:
                return True
        return False

    spans = crop.span_boxes(raw, bleed, stem_key)
    labels = [r for r, is_text in spans
              if not is_text
              and not any(not (r & av).is_empty
                          and (r & av).get_area() >= r.get_area() * 0.8 for av in avoid)]
    label_text = {id(r): page.get_text("text", clip=r).strip() for r in labels}

    core: list[pymupdf.Rect] = []
    core_raw: list[pymupdf.Rect] = []
    for b in raw.get("blocks", []):
        if b.get("type") == 0:
            continue
        r = pymupdf.Rect(*b["bbox"])
        if r.get_area() >= page_area * 0.7:
            continue
        inter = r & box
        if inter.is_empty or inter.width < 12 or inter.height < 12:
            continue
        core.append(r & room)
        core_raw.append(r)
    for d in page.get_drawings():
        r = pymupdf.Rect(d["rect"])
        if r.is_infinite or r.is_empty or r.get_area() >= page_area * 0.7:
            continue
        if (r & box).is_empty or inside_text(r):
            continue
        core.append(r & room)
        core_raw.append(r)
    if not core:
        return None, [], "벽 안에 잉크가 없다"

    core = crop.largest_cluster(core)
    if not core:
        return None, [], "덩어리가 안 남았다"
    out = core[0]
    for r in core[1:]:
        out |= r

    for _ in range(crop.LABEL_ROUNDS):
        grew = False
        band = pymupdf.Rect(out)
        for t in labels:
            if band.contains(t):
                continue
            if crop._touches(band, t, label_text.get(id(t), "")):
                out |= t
                grew = True
        if not grew:
            break

    # 완비 검사 — **그림 재료만** 본다. 지면 글자는 지울 것이므로 세지 않는다.
    edges = labels + core_raw
    for _ in range(crop.LABEL_ROUNDS):
        grew = False
        for t in edges:
            if out.contains(t) or (t & out).is_empty:
                continue
            merged = out | t
            if not bleed.contains(merged):
                continue
            out = merged
            grew = True
        if not grew:
            break
    for t in edges:
        if not out.contains(t) and not (t & out).is_empty:
            return None, [], "그림 재료를 반으로 자른다"

    out = out & page.rect
    if out.is_empty or out.width < 30 or out.height < 20:
        return None, [], f"너무 작다 {out.width:.0f}x{out.height:.0f}"

    rect = pymupdf.Rect(out.x0 - crop.PAD, out.y0 - crop.PAD,
                        out.x1 + crop.PAD, out.y1 + crop.PAD) & page.rect
    # **지울 것은 줄로 퍼뜨리지 않는다.** 조각이 스스로 지면 글자일 때만 지운다 —
    # 벽을 세울 때(`spans`)와 다른 눈이고, 그게 맞다: 지우는 것은 되돌릴 수 없다.
    erase = crop.span_boxes(raw, bleed, stem_key, propagate=False)
    masks = [r & rect for r, is_text in erase if is_text and not (r & rect).is_empty]
    return rect, masks, ""


def propose(page, src: pymupdf.Rect, stem_key: str, avoid: list[pymupdf.Rect],
            axis: str) -> tuple[list[tuple[pymupdf.Rect, list]], str]:
    """오려내기와 **같은 후보**(띠 없이 한 번 + 띠마다)로 벽을 세우고 지워 본다.

    ⚠️ 자동 경로(`--stem-split`)는 칸이 둘 이상이면 **버린다** — 어느 것이 그 문항의
       그림인지 본문이 말해 주지 않기 때문이다. **여기서는 버리지 않고 다 낸다.**
       이 시트의 존재 이유가 바로 그것이다: 본문이 못 가르는 것을 **사람이 본다.**
       실측으로 44건 중 17건이 「칸이 2~4개」였다 — 버리면 그만큼이 그냥 사라진다.
    """
    got: dict[tuple, tuple[pymupdf.Rect, list]] = {}
    last = "가를 자리가 없다"
    for pre in [None, *crop.stem_text_bands(page, src, stem_key, axis)]:
        ink: list[pymupdf.Rect] = []
        crop.figure_rect(page, src, stem_key, avoid=avoid, limit=pre, ink_out=ink)
        if not ink:
            continue
        wall = crop.stem_wall(page, src, stem_key, ink[0], axis, bound=pre)
        if wall is None:
            continue
        rect, masks, why = masked_figure(page, src, stem_key, avoid, wall)
        if rect is None:
            last = why
            continue
        got[tuple(round(v, 1) for v in rect)] = (rect, masks)
    return list(got.values()), ("" if got else last)


def render(pdf: str, page_index: int, rect: pymupdf.Rect, masks: list, dpi: int) -> bytes:
    """**글자만 뺀** 사본에서 칸을 뜬다. 원본 파일은 건드리지 않는다."""
    doc = pymupdf.open(pdf)
    page = doc[page_index]
    for m in masks:
        page.add_redact_annot(m)
    if masks:
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                              graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                              text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    png = page.get_pixmap(clip=rect, dpi=dpi).tobytes("png")
    doc.close()
    return png


def context(pdf: str, page_index: int, rect: pymupdf.Rect, masks: list) -> bytes:
    """지면 맥락 — 칸은 빨강, 지운 자리는 파랑. 무엇을 지웠는지 눈으로 본다."""
    doc = pymupdf.open(pdf)
    page = doc[page_index]
    page.draw_rect(rect, color=(1, 0, 0), width=1.0)
    for m in masks:
        page.draw_rect(m, color=(0, 0, 1), width=0.7)
    view = pymupdf.Rect(0, max(0, rect.y0 - 70), page.rect.x1,
                        min(page.rect.y1, rect.y1 + 70))
    png = page.get_pixmap(clip=view, dpi=140).tobytes("png")
    doc.close()
    return png


def neighbours(boxes, book: str, db_page: int, printed_of: dict, eid: str,
               rect: pymupdf.Rect) -> list[dict]:
    """칸이 **다른 문항의 좌표 상자**를 덮었나. 같은 무리의 형제는 표시해 둔다."""
    mine = printed_of.get(eid)
    hits = []
    for other in boxes.get(book, {}).get(str(db_page), []):
        if other["id"] == eid:
            continue
        o = pymupdf.Rect(*other["rect"])
        inter = o & rect
        if inter.is_empty or inter.get_area() <= crop.NEIGHBOR_OVERLAP * o.get_area():
            continue
        gap = (abs(int(other["printed"]) - int(mine))
               if mine and str(other["printed"]).isdigit() and str(mine).isdigit() else 99)
        hits.append({"문항": other["printed"], "id": other["id"][:13],
                     "번호차": gap, "형제": gap <= SIBLING_GAP})
    return hits


def build(dpi: int) -> None:
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    boxes = json.loads(BOXES.read_text(encoding="utf-8"))
    printed_of = {b["id"]: b["printed"]
                  for pages in boxes.values() for items in pages.values() for b in items}

    if SHOTS.exists():
        shutil.rmtree(SHOTS)
    SHOTS.mkdir(parents=True, exist_ok=True)
    rows = []
    for _tag, res_path, plan_path in RESULTS:
        res = json.loads(pathlib.Path(res_path).read_text(encoding="utf-8"))
        plan = {i["externalId"]: i for i in
                json.loads(pathlib.Path(plan_path).read_text(encoding="utf-8"))["목록"]}
        docs: dict[str, pymupdf.Document] = {}
        for f in res["실패"]:
            if "본문방향" not in f["이유"]:
                continue
            it = plan[f["externalId"]]
            docs.setdefault(it["pdf"], pymupdf.open(it["pdf"]))
            page = docs[it["pdf"]][int(it["page"]) - 1]
            box = pymupdf.Rect(*it["rect"]) & page.rect
            key = crop.content_key(content.get(it["problemId"], ""))
            axis, word = crop.stem_direction(content.get(it["problemId"], ""))
            avoid = [pymupdf.Rect(*a) for a in it.get("avoid", [])]
            # 「오른쪽 그림」이면 상자가 글자 열만 덮은 배치가 있다 — 오려내기와
            # **같은 자리**까지 넓혀서 본다(왼쪽 단은 지면 가운데에서 멈춘다).
            src = box
            if axis == "x":
                edge = (page.rect.x1 - crop.WIDEN_RIGHT_MARGIN
                        if box.x1 > crop.COLUMN_W else crop.COLUMN_W)
                if edge > box.x1 + 1:
                    src = pymupdf.Rect(box.x0, box.y0, edge, box.y1) & page.rect

            rec = {"externalId": f["externalId"], "problemId": it["problemId"],
                   "책": pathlib.Path(it["pdf"]).name, "쪽": int(it["page"]),
                   "축": word, "앞선사유": f["이유"]}
            if axis is None:
                rec["제안"] = False
                rec["막힘"] = "본문이 자리를 말하지 않는다"
                rows.append(rec)
                continue

            cands, why = propose(page, src, key, avoid, axis)
            if not cands:
                rec["후보"] = []
                rec["막힘"] = why
                rows.append(rec)
                continue

            out = SHOTS / f["externalId"]
            rec["후보"] = []
            off = int(it.get("pageOff", 0) or 0)
            for n, (rect, masks) in enumerate(cands, 1):
                mask_area = sum(m.get_area() for m in masks)
                cand = {
                    "번호": n,
                    "칸": [round(v, 2) for v in rect],
                    "지운자리": [[round(v, 2) for v in m] for m in masks],
                    "지움비율": round(mask_area / max(rect.get_area(), 1), 3),
                    "지운글자": " ".join(
                        page.get_text("text", clip=m).strip() for m in masks)[:200],
                    "선택지수": sum(1 for m in masks
                                if crop.EXAM_SYNTAX.search(page.get_text("text", clip=m))),
                    "옆문항": neighbours(boxes, rec["책"], int(it["page"]) - off,
                                      printed_of, f["externalId"], rect),
                }
                # **막힘**은 「이건 그림 칸이 아니다」라는 구조적 근거일 때만이다.
                # 지움비율 같은 눈금은 **주의**로만 적는다 — 눈이 이긴다.
                cand["발문지움"] = crop.longest_common_run(
                    crop.content_key(cand["지운글자"]), key)
                hard = []
                if cand["발문지움"] >= MASK_STEM_MAX:
                    hard.append(f"지운 것이 발문이다 ({cand['발문지움']}자)")
                if cand["선택지수"] > MASK_CHOICE_MAX:
                    hard.append(f"선택지 번호를 {cand['선택지수']}개 지웠다 — 보기가 그림인 문항")
                foreign = [x for x in cand["옆문항"] if not x["형제"]]
                if foreign:
                    hard.append(f"남의 문항 상자를 덮었다 ({foreign[0]['문항']})")
                cand["막힘"] = " · ".join(hard)
                warn = []
                if cand["지움비율"] > MASK_AREA_MAX:
                    warn.append(f"지운 자리가 칸의 {cand['지움비율']:.0%} 다")
                if cand["옆문항"]:
                    warn.append("같은 무리의 형제 상자를 덮었다")
                cand["주의"] = " · ".join(warn)

                shot = out / f"cand{n}"
                shot.mkdir(parents=True, exist_ok=True)
                (shot / "0.png").write_bytes(
                    render(it["pdf"], int(it["page"]) - 1, rect, masks, dpi))
                (shot / "page.png").write_bytes(
                    context(it["pdf"], int(it["page"]) - 1, rect, masks))
                rec["후보"].append(cand)
            rec["막힘"] = ("" if any(not c["막힘"] for c in rec["후보"])
                          else " / ".join(c["막힘"] for c in rec["후보"]))
            rows.append(rec)
        for d in docs.values():
            d.close()

    goers = [r for r in rows if any(not c["막힘"] for c in r.get("후보", []))]
    SHEET.write_text(json.dumps({
        "기준": "본문방향으로 못 가른 행 — 같은 벽 안에서 지면 글자를 지우고 오려 본 것",
        "대상": len(rows),
        "볼것": len(goers),
        "칸": sum(len(r.get("후보", [])) for r in rows),
        "목록": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"── 검수 시트 ── 대상 {len(rows)} · 사람이 볼 행 {len(goers)}"
          f" · 낸 칸 {sum(len(r.get('후보', [])) for r in rows)}"
          f" · 칸이 하나도 안 나온 행 {sum(1 for r in rows if not r.get('후보'))}")
    for r in rows:
        if not r.get("후보"):
            print(f"   칸 없음 {r['externalId'][:13]} — {r['막힘']}")
        elif not any(not c["막힘"] for c in r["후보"]):
            print(f"   전부 막힘 {r['externalId'][:13]} — {r['막힘']}")
    print(f"→ {SHEET}\n→ {SHOTS}/<id>/0.png (그대로 붙을 칸) · page.png (지면 맥락)")
    print("   눈으로 보고 판정을 적어라 →", DECISION)


def apply() -> None:
    sheet = json.loads(SHEET.read_text(encoding="utf-8"))
    if not DECISION.exists():
        raise SystemExit(f"판정 파일이 없다: {DECISION}\n먼저 시트를 눈으로 보고 적어라.")
    decision = json.loads(DECISION.read_text(encoding="utf-8"))["판정"]

    rows = {r["externalId"]: r for r in sheet["목록"]}
    unseen = [e for e in rows if e not in decision]
    if unseen:
        raise SystemExit(
            f"판정이 안 적힌 행이 {len(unseen)}개 있다 — 조용히 빼지 않는다:\n  "
            + "\n  ".join(e[:13] for e in unseen))
    stray = [e for e in decision if e not in rows]
    if stray:
        raise SystemExit(f"시트에 없는 행에 판정이 적혀 있다: {[e[:13] for e in stray]}")

    ok: list[dict] = []
    for eid, verdict in decision.items():
        if verdict["판정"] != "쓴다":
            continue
        row = rows[eid]
        if verdict.get("후보") == "recut":
            cand = row.get("사람이그린칸")
            if cand is None:
                raise SystemExit(f"{eid[:13]}: 사람이 그린 칸이 없다 — 먼저 --recut 을 돌려라")
            src = SHOTS / eid / "recut" / "0.png"
        else:
            n = int(verdict.get("후보", 1))
            cand = next((c for c in row.get("후보", []) if c["번호"] == n), None)
            if cand is None:
                raise SystemExit(f"{eid[:13]}: 후보 {n} 번이 없다")
            if cand["막힘"]:
                raise SystemExit(f"{eid[:13]}: 막힌 칸을 「쓴다」로 적었다 — {cand['막힘']}")
            src = SHOTS / eid / f"cand{n}" / "0.png"
        dst = pathlib.Path("public/figures/rpm") / eid / "0.png"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        ok.append({"problemId": row["problemId"],
                   "publicPath": "/" + dst.as_posix().split("public/", 1)[1],
                   "칸": cand["칸"], "지운자리": cand["지운자리"],
                   "검수": verdict.get("사유", "사람이 봤다")})
    APPLIED.write_text(json.dumps({
        "기준": "검수 시트에서 사람이 「쓴다」로 판정한 것",
        "대상": len(rows), "성공수": len(ok), "실패수": len(rows) - len(ok),
        "실패": [{"externalId": e, "이유": v.get("사유", "")}
               for e, v in decision.items() if v["판정"] != "쓴다"],
        "성공": ok,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"「쓴다」 {len(ok)}건 → public/figures/rpm/ · 결과 {APPLIED}")


def _row(prefix: str):
    """시트에서 행 하나와 그 계획을 찾는다."""
    sheet = json.loads(SHEET.read_text(encoding="utf-8"))
    row = next((r for r in sheet["목록"] if r["externalId"].startswith(prefix)), None)
    if row is None:
        raise SystemExit(f"시트에 없는 id: {prefix}")
    for _tag, _res, plan_path in RESULTS:
        plan = {i["externalId"]: i for i in
                json.loads(pathlib.Path(plan_path).read_text(encoding="utf-8"))["목록"]}
        if row["externalId"] in plan:
            return row, plan[row["externalId"]]
    raise SystemExit(f"계획에 없는 id: {prefix}")


def probe(prefix: str) -> None:
    """**좌표를 눈으로 고르기 위한 지도.** 잉크 조각·지면 글자를 좌표째로 찍는다.

    그림은 있는데 자동으로 잡은 네모가 나쁠 때, 사람이 네모를 **숫자로** 그려 줄 수
    있어야 한다. 화면의 픽셀을 눈대중하지 않게 여기서 좌표를 낸다.
    """
    row, it = _row(prefix)
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    doc = pymupdf.open(it["pdf"])
    page = doc[int(it["page"]) - 1]
    key = crop.content_key(content.get(it["problemId"], ""))
    print(f"== {row['externalId'][:13]} {row['책']} p{row['쪽']} 상자={[round(v,1) for v in it['rect']]}")
    for c in row.get("후보", []):
        print(f"   후보{c['번호']} 칸={c['칸']} 지움{c['지움비율']:.0%} "
              f"발문지움{c.get('발문지움', '?')} {c['막힘'] or c['주의']}")
    parea = page.rect.get_area()
    # **문항 둘레만** 본다 — 쪽 전체를 찍으면 고르기가 더 어려워진다.
    look = pymupdf.Rect(*it["rect"])
    look = pymupdf.Rect(look.x0 - crop.BOX_BLEED, look.y0 - crop.BOX_BLEED,
                        look.x1 + crop.BOX_BLEED, look.y1 + crop.BOX_BLEED) & page.rect
    print(f"   ── 둘레 {[round(v,1) for v in look]} 안만 본다 ──")
    # **덩어리로 묶어서** 보여 준다. 획을 낱개로 찍으면 수백 줄이라 고를 수가 없다.
    pieces = []
    for b in page.get_text("rawdict").get("blocks", []):
        if b.get("type") == 0:
            continue
        r = pymupdf.Rect(*b["bbox"])
        if r.get_area() < parea * 0.7 and not (r & look).is_empty:
            pieces.append(r)
    for d in page.get_drawings():
        r = pymupdf.Rect(d["rect"])
        if r.is_infinite or r.is_empty or r.get_area() >= parea * 0.7:
            continue
        if not (r & look).is_empty:
            pieces.append(r)
    groups: list[list[pymupdf.Rect]] = []
    for r in pieces:
        near = [g for g in groups
                if any(max(x.x0 - r.x1, r.x0 - x.x1, 0) <= 12
                       and max(x.y0 - r.y1, r.y0 - x.y1, 0) <= 12 for x in g)]
        if not near:
            groups.append([r])
            continue
        first = near[0]
        first.append(r)
        for other in near[1:]:
            first.extend(other)
            groups.remove(other)
    print("   ── 잉크 덩어리 (큰 것부터) ─────────────────")
    boxes = []
    for g in groups:
        u = g[0]
        for r in g[1:]:
            u |= r
        boxes.append((u.get_area(), u, len(g)))
    for area, u, n in sorted(boxes, reverse=True, key=lambda t: t[0])[:8]:
        print(f"      [{u.x0:6.1f},{u.y0:6.1f},{u.x1:6.1f},{u.y1:6.1f}] {u.width:5.0f}x{u.height:5.0f}pt 조각{n}")
    print("   ── 글자 (● = 지면 글자, 지울 것) ───────────")
    for r, is_text in crop.span_boxes(page.get_text("rawdict"), look, key,
                                      propagate=False):
        t = page.get_text("text", clip=r).strip().replace("\n", " ")
        print(f"      {'●' if is_text else '○'} [{r.x0:6.1f},{r.y0:6.1f},{r.x1:6.1f},{r.y1:6.1f}] {t[:40]!r}")
    doc.close()


def recut(prefix: str, box: list[float], dpi: int, keep: bool = False) -> None:
    """사람이 준 네모로 다시 떠 본다 — `scripts/qa/reports/rpm-stem-sheet/<id>/recut/`.

    ⚠️ **사람이 그린 네모에서는 «발문만» 지운다.** 자동 경로는 한글·선택지 번호까지
       지면 글자로 보는데(벽을 세우려면 그래야 한다), 그 눈은 그림 안의 한글 라벨
       (`(명)` `(분)` 축 이름)까지 지운다. 네모를 사람이 확인한 자리에서는 지울 근거를
       **DB 본문에 있는 것**으로 좁힌다 — 그리고 그 결과를 다시 눈으로 본다.
    """
    row, it = _row(prefix)
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    doc = pymupdf.open(it["pdf"])
    page = doc[int(it["page"]) - 1]
    key = crop.content_key(content.get(it["problemId"], ""))
    rect = pymupdf.Rect(*box) & page.rect
    # 계획이 「여기는 그림이 아니다」로 짚어 둔 자리(문항 번호 배지·머리글)도 지운다 —
    # 무리 지면에서는 배지가 그림에 **겹쳐** 있어 네모로는 못 뺀다(실측 1-2 p123 `0813`).
    avoid = [pymupdf.Rect(*a) for a in it.get("avoid", [])]
    # ⚠️ `--keep` — **아무것도 안 지운다.** 그림 라벨이 하필 발문에도 있는 배치가 있다
    #    (실측 3-2 p114 `0650`: 가로축 이름 「달리기(초)」가 발문의 「100 m 달리기」와
    #    같은 낱말이라 지워졌다). 사람이 네모를 발문 **밖**으로 그렸다면 지울 이유가 없다.
    masks = []
    if keep:
        avoid = []
    for r, _is_text in crop.span_boxes(page.get_text("rawdict"), rect, key,
                                       propagate=False):
        if keep:
            break
        k = crop.content_key(page.get_text("text", clip=r))
        if (len(k) >= crop.STEM_LINE_CHARS_SPAN
                and crop.longest_common_run(k, key) >= crop.STEM_LINE_CHARS_SPAN):
            masks.append(r & rect)
        elif any(not (r & av).is_empty and (r & av).get_area() >= r.get_area() * 0.5
                 for av in avoid):
            masks.append(r & rect)
    erased = " ".join(page.get_text("text", clip=m).strip() for m in masks)[:200]
    doc.close()
    out = SHOTS / row["externalId"] / "recut"
    out.mkdir(parents=True, exist_ok=True)
    (out / "0.png").write_bytes(render(it["pdf"], int(it["page"]) - 1, rect, masks, dpi))
    (out / "page.png").write_bytes(context(it["pdf"], int(it["page"]) - 1, rect, masks))
    sheet = json.loads(SHEET.read_text(encoding="utf-8"))
    for r in sheet["목록"]:
        if r["externalId"] == row["externalId"]:
            r["사람이그린칸"] = {"칸": [round(v, 2) for v in rect],
                            "지운자리": [[round(v, 2) for v in m] for m in masks],
                            "지운글자": erased}
    SHEET.write_text(json.dumps(sheet, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{row['externalId'][:13]} recut {[round(v,1) for v in rect]} · 지운 조각 {len(masks)}")
    print(f"→ {out}/0.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=crop.DEFAULT_DPI)
    ap.add_argument("--apply", action="store_true",
                    help="판정이 「쓴다」인 것만 public/ 으로 옮기고 붙이기용 결과를 낸다")
    ap.add_argument("--probe", metavar="ID", help="좌표 지도를 찍는다(사람이 네모를 고를 때)")
    ap.add_argument("--recut", nargs=5, metavar=("ID", "X0", "Y0", "X1", "Y1"),
                    help="사람이 준 네모로 다시 떠 본다")
    ap.add_argument("--keep", action="store_true",
                    help="--recut 에서 **아무것도 지우지 않는다**(네모가 발문 밖일 때)")
    a = ap.parse_args()
    if a.probe:
        probe(a.probe)
    elif a.recut:
        recut(a.recut[0], [float(v) for v in a.recut[1:]], a.dpi, a.keep)
    elif a.apply:
        apply()
    else:
        build(a.dpi)


if __name__ == "__main__":
    main()
