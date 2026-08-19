# -*- coding: utf-8 -*-
"""기출 PDF 정본에서 **발문을 실마리로** 그 문항의 그림만 오려 낸다. 토큰 0 · API 0.

    npx tsx scripts/qa/build-pdf-figure-plan.ts        # 선행 — 계획
    python scripts/figure/crop-pdf-by-stem.py          # 드라이런(집계만)
    python scripts/figure/crop-pdf-by-stem.py --write  # public/figures/ 에 기록

입력: `scripts/qa/reports/pdf-figure-plan.json`
출력: `public/figures/<examId>/pdf-q<번호>.png`
      `scripts/qa/reports/pdf-figure-result.json`

## 좌표가 없다 — **글자가 곧 좌표다**

RPM 은 sumaek 이 문항 사각형을 갖고 있지만 기출은 없다. 대신 DB 본문이 있으니
**그 글자가 PDF 어느 쪽 어디에 있는지** 찾으면 그것이 좌표다. 쪽을 고를 때도
「본문과 가장 길게 겹치는 쪽」을 쓴다 — 판이 다르거나 쪽이 밀려도 따라간다.

## 여기 오는 문항은 **이미 한 번 놓친 것들**이다

`map-figures.py` 가 쪽 단위로 그림을 문항에 배정하는데, 이 대상은 그게 놓친 것만
모아 놓은 것이다. 같은 규칙을 다시 돌리면 같은 것을 놓친다. 그래서 판정 규칙은
RPM 쪽(`crop-rpm-from-pdf.py`)에서 쓰는 것을 그대로 가져온다 —
**발문은 DB 본문에 있고 그림 라벨은 없다.** 간격으로는 못 가른다.

## 안 되는 것은 안 한다

- 본문과 겹치는 쪽을 못 찾으면(`MIN_RUN` 미만) 건너뛴다.
- 오려낸 칸에 발문이 이어서 들어오면 버린다.
- 칸 경계를 반으로 자르는 요소가 남으면 버린다.
잘못 붙인 그림은 지면에서 티가 안 나므로, 애매하면 **안 붙이는 쪽**을 고른다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import fitz

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("croprpm", _HERE / "crop-rpm-from-pdf.py")
croprpm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(croprpm)

content_key = croprpm.content_key
longest_common_run = croprpm.longest_common_run
figure_rect = croprpm.figure_rect
PAD = croprpm.PAD
STEM_INTRUSION_CHARS = croprpm.STEM_INTRUSION_CHARS

PLAN = pathlib.Path("scripts/qa/reports/pdf-figure-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/pdf-figure-result.json")
FIGROOT = pathlib.Path("public/figures")
DPI = 200
#: 쪽을 정하려면 본문과 이만큼은 이어서 겹쳐야 한다. 더 짧으면 우연이다.
MIN_RUN = 20
#: 맞은 조각 중 이만큼(글자) 이상인 것만 발문 조각으로 센다.
MIN_BLOCK = 4
#: 긴 구간에서 세로로 이만큼(pt) 안쪽의 조각만 같은 문항으로 본다.
STEM_SPAN_PT = 130.0
#: 발문 아래로 이만큼(pt)까지 그림을 찾는다. 「다음 그림과 같이」는 아래에 온다.
BELOW_PT = 320.0
#: 발문 위·옆으로 이만큼(pt). 「오른쪽 그림과 같이」는 같은 줄 오른쪽에 온다.
AROUND_PT = 24.0
#: 오려낸 칸 안의 **한 줄**에 한글이 이만큼 있으면 그것은 그림 라벨이 아니라 «문장»이다.
#: ⚠️ 「내 발문이 들어왔나」만 보면 **옆 문항의 발문**은 구조적으로 안 보인다 —
#:    실측 3건(`3535-8`·`4139-8`·`2622-14`)이 다른 문항 발문·선택지를 통째로 담고도
#:    통과했다. 물어야 할 것은 «누구 발문인가»가 아니라 «문장이 들어왔나»다.
#: 진짜 라벨은 짧다 — 실측 최장이 「과학 성적(점)」·「오른쪽 시력」 수준(7~8자).
SENTENCE_KO = 12
#: 시험지 **자신의 서식**. 선택지 번호와 배점 표시는 그림에 있을 수 없다 —
#: 문항 낱말 목록이 아니라 지면 문법이라, 학교가 바뀌어도 그대로다.
#: 짧은 꼬리는 «한 줄 한글 12자» 규칙을 빠져나간다(실측 `2622-14`: 「…의 길이는? [2점]」
#: 이 한글 5자, `2622-16`: 선택지 「② 5√2 ④ 3√2」 는 한글 0자).
#: ⚠️ **숫자로 쓰면 안 된다.** 이 시험지들은 글꼴이 사유 영역으로 인코딩돼 있어
#:    배점의 `2` 가 문자 `2` 가 아니라 `` 로 나온다(실측). 그래서 대괄호와
#:    「점」만 보고 그 사이는 **무엇이든** 받는다 — 글자 종류에 기대지 않는다.
EXAM_SYNTAX = re.compile(r"[①-⑤]|[\[［][^\]］]{0,6}점\s*[\]］]")
#: 시험지 **머리띠**(학교·학년·과목·학원 로고) 판정. 낱말 목록으로 거르면 그 목록에
#: 없는 서식은 구조적으로 못 본다. 「쪽 위 + 넓다」로 갈랐더니 **쪽머리에 놓인 진짜
#: 그림 3건이 같이 걸렸다**(3509-14·3627-15·5466-6) — 위치는 가르는 성질이 아니다.
#: 가르는 성질은 **되풀이**다: 머리띠는 여러 쪽에 같은 자리 같은 크기로 나온다.
#: 그림은 한 번만 나온다.
FURNITURE_MIN_PAGES = 2
#: 되풀이 판정을 위한 좌표 반올림(pt). 쪽마다 1pt 안팎으로 흔들린다.
FURNITURE_ROUND = 3
#: 두께 0인 곧은 선을 이만큼 부풀려 «있는 것»으로 본다. `figure_rect` 의 첫 가드
#: `is_empty` 가 **곧은 선을 전부 버리기** 때문이다 — 실측으로 남은 44행 중 35행이
#: 「획이 아예 없다」로 떨어졌는데 그 쪽에는 획이 99개 있었다(97개가 두께 0).
THIN_STROKE_PT = 0.5
#: 문항 번호 표시(`11.` `12.`). 오려낸 칸이 **다른 문항 번호를 지나** 있으면 그것은
#: 옆 문항의 그림이다 — 이 저장소가 적어 둔 가장 큰 정밀도 한계가 그 부류다
#: (16-figure-recovery-ledger §3.3 「옆 문항 그림이 딸려 온다」).
#: 실측 `4082-11`: 발문은 11번인데 칸이 **12번 상자**를 집었다. 자동 검사 셋(발문 침입·
#: 선택지 표시·문장)이 전부 통과시켰다 — 그 상자 안에는 한글도 선택지 표시도 없기 때문이다.
#: 「누구 발문인가」가 아니라 **「번호를 넘었나」**를 물어야 갈린다.
QNUM = re.compile(r"^\s*(\d{1,2})\s*[.．]\s")


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def stem_box(page, stem: str) -> tuple[fitz.Rect, int] | None:
    """이 쪽에서 **이 문항의 발문**이 차지한 영역과 겹친 길이. 못 찾으면 None.

    낱말마다 「본문에 있나」를 묻지 않는다 — 짧은 낱말은 아무 데나 있어서, 그렇게
    하면 조각이 쪽 전체에 흩어지고 상자가 지면만 해진다. 그러면 그림 검출이
    **머리띠**를 집는다(실측 `4105-2`: 조각 88개, 상자 46~795pt, 결국 머리띠를 오렸다).

    대신 쪽의 낱말을 **읽는 순서대로 이어 붙인 한 줄**로 만들고, 본문과 **가장 길게
    이어지는 구간**을 찾아 그 구간의 낱말만 상자로 묶는다. 이어지는 구간이라는 조건이
    「흩어진 우연」을 구조적으로 배제한다.
    """
    words = page.get_text("words")
    keys, spans = [], []
    for w in words:
        k = content_key(w[4] or "")
        if not k:
            continue
        spans.append((len("".join(keys)), len(k), fitz.Rect(w[:4])))
        keys.append(k)
    page_key = "".join(keys)
    if not page_key:
        return None
    sm = SequenceMatcher(None, page_key, stem)
    blocks = [b for b in sm.get_matching_blocks() if b.size >= MIN_BLOCK]
    if not blocks:
        return None
    anchor = max(blocks, key=lambda b: b.size)
    if anchor.size < MIN_RUN:
        return None

    def bbox(lo: int, hi: int) -> fitz.Rect | None:
        box = None
        for start, size, rect in spans:
            if start + size <= lo or start >= hi:
                continue
            box = rect if box is None else (box | rect)
        return box

    core = bbox(anchor.a, anchor.a + anchor.size)
    if core is None:
        return None
    # 가장 긴 구간만 쓰면 상자가 **한 줄**이라 그림이 밖에 남는다. 그렇다고 맞은 조각을
    # 다 모으면 쪽 전체가 된다(짧은 조각은 아무 데나 있다). 그래서 **긴 구간 둘레
    # `STEM_SPAN_PT` 안에 있는 조각만** 더한다 — 한 문항이 차지하는 세로 길이다.
    box = fitz.Rect(core)
    for b in blocks:
        r = bbox(b.a, b.a + b.size)
        if r is None:
            continue
        if r.y1 < core.y0 - STEM_SPAN_PT or r.y0 > core.y1 + STEM_SPAN_PT:
            continue
        box |= r
    return box, anchor.size


def crossed_question_number(page, sb: fitz.Rect, fig: fitz.Rect, q: int) -> int | None:
    """발문과 오려낸 칸 사이(또는 칸 안)에 **다른 문항 번호**가 있으면 그 번호.

    문항 번호는 단(段)의 왼쪽 끝에서 시작한다. 선택지 번호도 `1.` 꼴일 수 있으므로
    **발문 왼쪽 끝보다 더 왼쪽이거나 같은 줄**만 본다 — 선택지는 들여쓰기가 있다.
    """
    top = min(sb.y1, fig.y0)
    bot = max(fig.y1, sb.y1)
    for b in page.get_text("dict").get("blocks", []):
        for ln in b.get("lines", []):
            r = fitz.Rect(ln["bbox"])
            if r.y1 <= top or r.y0 >= bot:
                continue
            # ⚠️ **같은 단(段)만 본다.** 시험지는 두 단이라, 단을 안 가르면 **옆 단의**
            #    문항 번호가 걸린다 — 실측으로 멀쩡한 `3195-20` 이 옆 단 18번 때문에
            #    버려졌다. 가로로 겹치는 줄만 같은 단이다.
            if r.x1 <= sb.x0 or r.x0 >= sb.x1:
                continue
            if r.x0 > sb.x0 + 2:          # 들여쓴 줄은 문항 번호가 아니다
                continue
            text = "".join(sp.get("text", "") for sp in ln.get("spans", []))
            m = QNUM.match(text)
            if m and int(m.group(1)) != q:
                return int(m.group(1))
    return None


def furniture_keys(doc) -> set[tuple[int, int, int, int]]:
    """여러 쪽에 **같은 자리 같은 크기**로 되풀이되는 그림틀 = 쪽 장식(머리띠·로고).

    낱말이 아니라 되풀이로 가른다 — 서식이 바뀌어도 걸리고, 진짜 그림은 안 걸린다.
    """
    seen: dict[tuple[int, int, int, int], set[int]] = {}
    for i in range(doc.page_count):
        page = doc[i]
        rects = [fitz.Rect(b["bbox"]) for b in page.get_text("rawdict").get("blocks", [])
                 if b.get("type") != 0]
        rects += [fitz.Rect(d["rect"]) for d in page.get_drawings()]
        for r in rects:
            # ⚠️ **두께 0인 선을 여기서 버리면 안 된다.** 단 사이 구분선·머리띠 밑줄이
            #    바로 그 모양이라, 버리면 「쪽마다 되풀이되는 것」 목록에 안 들어가고
            #    `thin_pt` 로 선을 살린 순간 그 장식이 그림으로 딸려 온다.
            if r.is_infinite or (r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0):
                continue
            k = tuple(int(round(v / FURNITURE_ROUND)) for v in (r.x0, r.y0, r.x1, r.y1))
            seen.setdefault(k, set()).add(i)
    return {k for k, pages in seen.items() if len(pages) >= FURNITURE_MIN_PAGES}


def pick_page(doc, stem: str) -> tuple[int, int]:
    """본문과 가장 길게 겹치는 쪽. (쪽 index, 겹친 길이)"""
    best = (-1, 0)
    for i in range(doc.page_count):
        run = longest_common_run(content_key(doc[i].get_text("text")), stem)
        if run > best[1]:
            best = (i, run)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int)
    # 입력 PDF 가 둘이다(정본 · 한글이 찍은 것). 같은 이름으로 쓰면 뒤엣것이 앞엣것을
    # 덮어써서 **무엇을 눈으로 봤는지** 알 수 없게 된다. 그래서 이름을 가른다.
    ap.add_argument("--plan", default=str(PLAN))
    ap.add_argument("--result", default=str(RESULT))
    ap.add_argument("--prefix", default="pdf", help="산출물 이름 앞머리")
    a = ap.parse_args()

    items = json.loads(pathlib.Path(a.plan).read_text(encoding="utf-8"))["목록"]
    if a.limit:
        items = items[: a.limit]

    docs: dict[str, fitz.Document] = {}
    furniture: dict[str, set] = {}
    ok, fail = [], []
    try:
        for it in items:
            stem = content_key(it["content"])
            if it["pdf"] not in docs:
                docs[it["pdf"]] = fitz.open(it["pdf"])
            doc = docs[it["pdf"]]

            pi, run = pick_page(doc, stem)
            if pi < 0 or run < MIN_RUN:
                fail.append({"externalId": it["externalId"],
                             "이유": f"본문이 있는 쪽을 못 찾았다 (최장 {run}자)"})
                continue
            page = doc[pi]
            found = stem_box(page, stem)
            if found is None:
                fail.append({"externalId": it["externalId"], "이유": "쪽 안에서 발문 위치를 못 잡았다"})
                continue
            sb, _ = found

            box = fitz.Rect(sb.x0 - AROUND_PT, sb.y0 - AROUND_PT,
                            sb.x1 + AROUND_PT, sb.y1 + BELOW_PT) & page.rect
            # 상자가 **발문에서 추정한 것**이라 그림이 끝에 살짝만 걸친다 —
            # RPM 처럼 12pt 를 요구하면 실측 44건이 「그림 없음」으로 떨어진다.
            if it["pdf"] not in furniture:
                furniture[it["pdf"]] = furniture_keys(doc)
            fig = figure_rect(page, box, stem, min_overlap=4.0,
                              thin_pt=THIN_STROKE_PT,
                              furniture=furniture[it["pdf"]])
            if fig is None:
                fail.append({"externalId": it["externalId"], "이유": "문항 둘레에서 그림을 못 찾았다"})
                continue
            rect = fitz.Rect(fig.x0 - PAD, fig.y0 - PAD, fig.x1 + PAD, fig.y1 + PAD) & page.rect

            box_key = content_key(page.get_text("text", clip=rect))
            run2 = longest_common_run(box_key, stem)
            if run2 >= STEM_INTRUSION_CHARS:
                fail.append({"externalId": it["externalId"], "이유": f"칸에 발문이 {run2}자 들어왔다"})
                continue
            fk = tuple(int(round(v / FURNITURE_ROUND)) for v in (fig.x0, fig.y0, fig.x1, fig.y1))
            if fk in furniture[it["pdf"]]:
                fail.append({"externalId": it["externalId"], "이유": "쪽마다 되풀이되는 쪽 장식이다"})
                continue
            crossed = crossed_question_number(page, sb, fig, int(it["q"]))
            if crossed is not None:
                fail.append({"externalId": it["externalId"],
                             "이유": f"칸이 다른 문항 번호({crossed}번)를 넘었다"})
                continue
            box_text = page.get_text("text", clip=rect)
            if EXAM_SYNTAX.search(box_text):
                fail.append({"externalId": it["externalId"], "이유": "칸에 선택지·배점 표시가 들어왔다"})
                continue
            longest_line = max(
                (sum(1 for ch in ln if "가" <= ch <= "힣")
                 for ln in page.get_text("text", clip=rect).splitlines()),
                default=0,
            )
            if longest_line >= SENTENCE_KO:
                fail.append({"externalId": it["externalId"],
                             "이유": f"칸에 문장이 들어왔다 (한 줄 한글 {longest_line}자)"})
                continue

            out = FIGROOT / it["e"] / f"{a.prefix}-q{int(it['q']):02d}.png"
            url = f"/figures/{it['e']}/{out.name}"
            if a.write:
                out.parent.mkdir(parents=True, exist_ok=True)
                page.get_pixmap(clip=rect, dpi=DPI).save(str(out))
            ok.append({"id": it["id"], "externalId": it["externalId"], "e": it["e"],
                       "q": it["q"], "page": pi + 1, "run": run,
                       "urls": [url], "publicPath": url})
    finally:
        for d in docs.values():
            d.close()

    RESULT_P = pathlib.Path(a.result)
    RESULT_P.parent.mkdir(parents=True, exist_ok=True)
    RESULT_P.write_text(json.dumps(
        {"기록": a.write, "대상": len(items), "성공수": len(ok), "실패수": len(fail),
         "실패": fail, "계획": ok}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("── PDF 발문 기준 오려내기 ──", "기록함" if a.write else "드라이런")
    print(f"  대상 {len(items)} · 성공 {len(ok)} · 실패 {len(fail)}")
    why: dict[str, int] = {}
    for f in fail:
        why[f["이유"].split("(")[0].strip()] = why.get(f["이유"].split("(")[0].strip(), 0) + 1
    for k, v in sorted(why.items(), key=lambda kv: -kv[1]):
        print(f"     {k} {v}")
    print(f"→ {RESULT_P}")


if __name__ == "__main__":
    main()
