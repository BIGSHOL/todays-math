# -*- coding: utf-8 -*-
"""**표가 곧 보기인 문항**의 표를 원본 PDF 에서 오려 낸다. 토큰 0 · API 0.

    npx tsx scripts/qa/build-table-crop-plan.ts        # 선행 — 계획
    python scripts/figure/crop-table-by-stem.py        # 드라이런
    python scripts/figure/crop-table-by-stem.py --write

입력: `scripts/qa/reports/table-crop-plan.json`
출력: `public/figures/<examId>/tbl-q<번호>.png`
      `scripts/qa/reports/table-crop-result.json`

## 왜 `crop-pdf-by-stem.py` 로는 안 되나

그쪽은 「발문 둘레에서 **그림**을 찾는다」이고, 오려낸 칸에 **발문·선택지 표시가
들어오면 버린다.** 그런데 이 부류는 **표 칸 안에 ①②③④⑤ 가 들어 있는 것이 정상**이다
(실측 `5348-8` 「자연수/정수/유리수에 ○×표를 할 때 나머지 넷과 결과가 다른 하나는?」).
그 가드가 옳게 걸려서 3행이 전부 떨어졌다 — **가드를 풀 것이 아니라 다른 도구를 써야 한다.**

## 열쇠 — 표는 «찾는» 것이지 «획 덩어리로 뭉치는» 것이 아니다

PyMuPDF `page.find_tables()` 가 표를 준다. 발문 상자에 가장 가까운 표를 고른다.
쪽 전체를 덮는 `1xN` 짜리는 **단 배치**(page furniture)라 뺀다.

## ⚠️ `find_tables` 는 **마지막 열을 놓칠 수 있다**

실측 `3936-1`: 3열 표를 `5x2` 로 잡아 **「간단히 나타내기」 열이 통째로 잘렸다.**
그 열에 ①③⑤ 가 들어 있었으니 붙였으면 못 푸는 표가 지면에 나간다.

문턱을 만지는 대신 **표 자신의 구조**를 쓴다 — 표의 세로 범위에 걸친 **가로 줄금**의
오른쪽 끝이 곧 표의 오른쪽 끝이다. 줄금은 두께 0인 곧은 선이라
`fitz.Rect.is_empty` 로 거르면 안 된다(같은 함정을 `figure_rect` 에서 이미 겪었다).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys

import fitz

sys.stdout.reconfigure(encoding="utf-8")

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("crop", _HERE / "crop-pdf-by-stem.py")
crop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crop)

PLAN = pathlib.Path("scripts/qa/reports/table-crop-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/table-crop-result.json")
FIGROOT = pathlib.Path("public/figures")
DPI = 200
PAD = 3.0
#: 쪽을 이만큼 덮으면 표가 아니라 **단 배치**다.
FURNITURE_AREA = 0.5
#: 줄금이라고 보는 두께(pt)와 최소 길이(pt).
RULE_THICK = 0.6
RULE_MIN_W = 20.0


def table_rect(page, tb: fitz.Rect) -> fitz.Rect:
    """`find_tables` 가 준 상자를 **표 자신의 가로 줄금**으로 다시 잰다."""
    right = tb.x1
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        w, h = r.x1 - r.x0, r.y1 - r.y0
        if h > RULE_THICK or w < RULE_MIN_W:
            continue
        if not (tb.y0 - PAD <= r.y0 <= tb.y1 + PAD):
            continue
        if r.x0 > tb.x0 + 6:          # 표 왼쪽에서 시작하는 줄금만
            continue
        right = max(right, r.x1)
    return fitz.Rect(tb.x0 - PAD, tb.y0 - PAD, right + PAD, tb.y1 + PAD)


def pick_table(page, sb: fitz.Rect):
    """발문에 가장 가까운 표. 쪽을 덮는 것(단 배치)은 뺀다."""
    area = page.rect.get_area()
    best, bestd = None, None
    for t in page.find_tables().tables:
        r = fitz.Rect(t.bbox)
        if r.is_empty or r.get_area() >= area * FURNITURE_AREA:
            continue
        if t.row_count < 2 or t.col_count < 2:
            continue
        d = max(sb.y0 - r.y1, r.y0 - sb.y1, 0)
        if bestd is None or d < bestd:
            best, bestd = (t, r), d
    return best, bestd


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    items = json.loads(PLAN.read_text(encoding="utf-8"))["목록"]
    docs: dict[str, fitz.Document] = {}
    ok, fail = [], []
    for it in items:
        if it["pdf"] not in docs:
            docs[it["pdf"]] = fitz.open(it["pdf"])
        doc = docs[it["pdf"]]
        stem = crop.content_key(it["content"])
        pno, run = crop.pick_page(doc, stem)
        if pno < 0 or run < crop.MIN_RUN:
            fail.append({"externalId": it["externalId"],
                         "이유": f"본문이 있는 쪽을 못 찾았다 (최장 {run}자)"})
            continue
        page = doc[pno]
        got = crop.stem_box(page, stem)
        if got is None:
            fail.append({"externalId": it["externalId"], "이유": "쪽 안에서 발문 위치를 못 잡았다"})
            continue
        sb = got[0]
        picked, dist = pick_table(page, sb)
        if picked is None:
            fail.append({"externalId": it["externalId"], "이유": "문항 둘레에 표가 없다"})
            continue
        t, tb = picked
        rect = table_rect(page, tb) & page.rect
        # 표가 다른 문항으로 넘어가면 버린다 (crop-pdf-by-stem 과 같은 검사).
        crossed = crop.crossed_question_number(page, sb, rect, int(it["q"]))
        if crossed is not None:
            fail.append({"externalId": it["externalId"],
                         "이유": f"표가 다른 문항 번호({crossed}번)를 넘었다"})
            continue
        name = f"tbl-q{int(it['q']):02d}.png"
        url = f"/figures/{it['e']}/{name}"
        dest = FIGROOT / it["e"] / name
        if a.write:
            dest.parent.mkdir(parents=True, exist_ok=True)
            page.get_pixmap(clip=rect, dpi=DPI).save(str(dest))
        ok.append({"id": it["id"], "externalId": it["externalId"], "e": it["e"],
                   "q": it["q"], "page": pno + 1,
                   "표": f"{t.row_count}x{t.col_count}",
                   "넓힘": round(rect.x1 - tb.x1, 1),
                   "urls": [url], "publicPath": url})

    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(
        {"기록": a.write, "대상": len(items), "성공수": len(ok), "실패수": len(fail),
         "실패": fail, "계획": ok}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("── 표 오려내기 ──", "기록함" if a.write else "드라이런")
    print(f"  대상 {len(items)} · 성공 {len(ok)} · 실패 {len(fail)}")
    for o in ok:
        print(f"    {o['externalId']}  표 {o['표']}  오른쪽으로 {o['넓힘']}pt 넓힘")
    for f in fail:
        print(f"    ✗ {f['externalId']}  {f['이유']}")
    print(f"→ {RESULT}")


if __name__ == "__main__":
    main()
