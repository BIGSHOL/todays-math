# -*- coding: utf-8 -*-
"""완료본 PDF의 그림을 **문항 번호에 붙인다**. LLM 토큰 0.

원리: PyMuPDF `get_text("rawdict")` 의 블록 스트림에는 텍스트 블록과 **이미지
블록이 문서 순서 그대로** 섞여 나온다. 앞에서부터 훑으며 줄머리 `N.` 을 만나면
현재 문항 번호를 갱신하고, 이미지 블록을 만나면 그 번호에 매단다.

⚠️ 2단 조판도 PyMuPDF 블록 순서가 이미 풀어 준다(textlayer.read_order 의 교훈 —
y 좌표로 다시 정렬하면 인라인 분수 때문에 문항 머리가 뒤로 밀린다).

검증: exam_index 의 본문에 '그림' 이 있는 문항과 실제로 붙은 문항을 대조한다.

사용:
  python scripts/figure/map-figures.py <exam_id> [--save 디렉터리]
  python scripts/figure/map-figures.py --batch 30      여러 편 정확도 집계
"""
import argparse
import collections
import json
import pathlib
import random
import re
import sqlite3
import sys

import fitz

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "qa"))
from tc_paths import exam_index_db, testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))
import textlayer  # noqa: E402  (경로 주입 후에만 import 가능)

IDX = exam_index_db()
PAGES = TC / "db" / "pages"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

QNUM = re.compile(r"^\s*(\d{1,2})\s*[.)]\s")
# ⚠️ '그래프'·'도형' 만으로 판정하면 안 된다 — "이차함수의 그래프는…" 처럼 그림 없이
#    쓰이는 말이 흔해 기준이 부풀어 재현율이 낮게 나온다(첫 측정 60%의 주원인).
#    프로젝트 다른 검사(ocr-audit)와 같은 엄격한 표현만 본다.
FIGURE_WORD = re.compile(
    r"그림과\s*같|그림에서|그림은|아래\s*그림|다음\s*그림|위\s*그림|\[그림|"
    r"그림처럼|그림의"
)


def block_text(blk: dict) -> str:
    return "".join(
        ch["c"]
        for line in blk.get("lines", [])
        for sp in line.get("spans", [])
        for ch in sp.get("chars") or []
    )


def first_line_text(blk: dict) -> str:
    lines = blk.get("lines") or []
    if not lines:
        return ""
    return "".join(
        ch["c"] for sp in lines[0].get("spans", []) for ch in sp.get("chars") or []
    )


def _cluster(rects, gap: float = 14.0):
    """가까운 벡터 조각을 잇는다 — 그림 하나는 선 수십 개로 쪼개져 있다.

    반환은 (x0, y0, x1, y1, 획수). 획수는 박스 하나와 그림을 가르는 기준이다.
    """
    boxes = [[x0, y0, x1, y1, n] for x0, y0, x1, y1, n in rects]
    merged = True
    while merged:
        merged = False
        out: list[list[float]] = []
        for b in boxes:
            hit = None
            for o in out:
                if (
                    b[0] <= o[2] + gap
                    and o[0] <= b[2] + gap
                    and b[1] <= o[3] + gap
                    and o[1] <= b[3] + gap
                ):
                    hit = o
                    break
            if hit:
                hit[0] = min(hit[0], b[0])
                hit[1] = min(hit[1], b[1])
                hit[2] = max(hit[2], b[2])
                hit[3] = max(hit[3], b[3])
                hit[4] += b[4]
                merged = True
            else:
                out.append(b[:])
        boxes = out
    return [tuple(b) for b in boxes]


def _page_layout(page):
    """(문항번호 앵커, 그림 후보) — 둘 다 (단, y) 로 정렬 가능한 형태."""
    W, mid = page.rect.width, page.rect.width / 2
    raw = page.get_text("rawdict")
    anchors, images = [], []
    for blk in raw.get("blocks", []):
        bbox = blk.get("bbox", (0, 0, 0, 0))
        if blk.get("type") == 0:
            m = QNUM.match(first_line_text(blk))
            if m:
                anchors.append((0 if bbox[0] < mid else 1, bbox[1], int(m.group(1))))
            continue
        x0, y0, x1, y1 = bbox
        if x1 - x0 < 24 or y1 - y0 < 24:
            continue
        if y0 < 110 and x1 - x0 > W * 0.6:
            continue  # 머리 배너(로고)
        images.append((0 if (x0 + x1) / 2 < mid else 1, y0, bbox))
    # ── 벡터로 그린 그림 ────────────────────────────────────────────────
    # 완료본 대부분은 그림을 이미지로 심지만, 일부는 **벡터 경로**로 그린다
    # (실측 4213 문항 3). 이미지 블록만 보면 통째로 놓친다.
    # 보기/조건 박스(사각형 하나 + 안쪽 글자)와 구분하려고 **획이 여럿인 군집**만 남긴다.
    vec = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.is_empty or r.is_infinite:
            continue
        if r.width > W * 0.8 or r.height > page.rect.height * 0.8:
            continue  # 쪽 테두리·단 구분선
        if r.height < 2 and r.width > 120:
            continue  # 긴 밑줄
        vec.append((r.x0, r.y0, r.x1, r.y1, len(d.get("items") or [])))

    for cx0, cy0, cx1, cy1, strokes in _cluster(vec):
        w, h = cx1 - cx0, cy1 - cy0
        if w < 40 or h < 30:
            continue
        # 획이 적으면 박스 하나일 뿐이다 — 그림이 아니다.
        if strokes < 4:
            continue
        # 이미 이미지로 잡힌 영역과 겹치면 중복이다.
        if any(
            not (cx1 < bx0 or bx1 < cx0 or cy1 < by0 or by1 < cy0)
            for _, _, (bx0, by0, bx1, by1) in images
        ):
            continue
        images.append((0 if (cx0 + cx1) / 2 < mid else 1, cy0, (cx0, cy0, cx1, cy1)))

    # 우단에 번호가 없으면 1단 조판 — 단 구분을 무시한다.
    if not any(c == 1 for c, _, _ in anchors):
        anchors = [(0, y, n) for _, y, n in anchors]
        images = [(0, y, b) for _, y, b in images]
    anchors.sort(key=lambda a: (a[0], a[1]))
    return anchors, images


def map_exam(pdf: pathlib.Path) -> dict[int, list[dict]]:
    """{문항번호: [{page, xref, rect}]}

    배치는 **좌표**로 한다 — 같은 단에서 그림보다 위에 있는 마지막 문항 번호.
    블록 '순서'만 믿으면 떠 있는 그림이 자기 번호보다 앞에 나와 앞 문항에 붙는다.

    ⚠️ textlayer.extract() 의 문항 분할을 그대로 쓰면 재현율이 77%까지 떨어진다 —
    그쪽은 '번호가 1씩 이어질 때만' 문항으로 인정해(본문 속 "3." 오인 방지) 중간에
    한 번 끊기면 뒤가 통째로 안 잡힌다. 배치는 좌표로 하고, textlayer 는 **본문
    텍스트**를 얻는 용도로만 쓴다.

    ⚠️ 공통 지문 그림 — 한 그림이 뒤따르는 문항의 지문일 때가 있다(실측 5333:
    최대공약수 관계도가 2·3번의 '수 A/수 B' 를 정의하는데 물리적으로는 1번 아래).
    앞 문항이 그림을 언급하지 않고 뒤 문항이 언급하면 넘긴다.

    ⚠️ **알려진 한계** — 뒤 문항이 그림을 '그림' 이라 부르지 않으면(5333 의 2번은
    "수 A 를 소인수분해 했을 때…") 이 규칙이 안 걸려 앞 문항에 남는다. 키워드로는
    풀 수 없는 경우라 그대로 둔다. 검수 화면에서 사람이 옮길 수 있게 할 것.
    """
    doc = fitz.open(pdf)
    result: dict[int, list[dict]] = collections.defaultdict(list)
    last_number = None

    for pno in range(doc.page_count):
        page = doc[pno]
        anchors, images = _page_layout(page)
        xref_by_rect = {}
        for im in page.get_images(full=True):
            for r in page.get_image_rects(im[0]):
                xref_by_rect[(round(r.x0), round(r.y0), round(r.x1), round(r.y1))] = im[0]

        for col, y, bbox in images:
            above = [n for c, ay, n in anchors if (c, ay) <= (col, y)]
            number = above[-1] if above else last_number
            if number is None:
                continue
            x0, y0, x1, y1 = bbox
            result[number].append({
                "page": pno,
                "xref": xref_by_rect.get((round(x0), round(y0), round(x1), round(y1))),
                "rect": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
            })
        if anchors:
            last_number = anchors[-1][2]
    doc.close()

    # 본문 텍스트는 textlayer 에서 — 공통 지문 넘기기 판단에만 쓴다.
    try:
        meta = textlayer.extract(pdf)
        text_of = {
            q["number"]: " ".join(str(b.get("value") or "") for b in (q.get("contents") or []))
            for q in (meta.get("questions") or []) if q.get("number") is not None
        }
    except Exception:
        text_of = {}

    for num in sorted(result):
        nxt = num + 1
        if num not in text_of or nxt not in text_of:
            continue
        if FIGURE_WORD.search(text_of[num]):
            continue
        if FIGURE_WORD.search(text_of[nxt]):
            result.setdefault(nxt, []).extend(result.pop(num))

    return dict(result)


def figure_questions(con, eid: int) -> set[int]:
    """본문이 그림을 가리키는 문항 번호."""
    out = set()
    for number, ocr in con.execute(
        "select number, ocr_json from questions where exam_id=?", (eid,)
    ):
        if not ocr:
            continue
        try:
            o = json.loads(ocr)
        except Exception:
            continue
        text = " ".join(
            str(b.get("value") or "") for b in (o.get("contents") or [])
        )
        if FIGURE_WORD.search(text):
            out.add(number)
    return out


def run_one(eid: int, save: pathlib.Path | None) -> tuple[int, int, int]:
    con = sqlite3.connect(IDX)
    pdf = PAGES / str(eid) / "src.pdf"
    mapped = map_exam(pdf)
    want = figure_questions(con, eid)
    got = set(mapped)

    if save:
        save.mkdir(parents=True, exist_ok=True)
        doc = fitz.open(pdf)
        for num, figs in sorted(mapped.items()):
            for i, f in enumerate(figs):
                if not f["xref"]:
                    continue
                info = doc.extract_image(f["xref"])
                name = f"q{num:02d}" + (f"_{i}" if i else "") + f'.{info["ext"]}'
                (save / name).write_bytes(info["image"])
        doc.close()

    return len(want), len(want & got), len(got - want)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("exam", nargs="?", type=int)
    ap.add_argument("--save")
    ap.add_argument("--batch", type=int)
    a = ap.parse_args()

    if a.batch:
        con = sqlite3.connect(IDX)
        cached = {p.name for p in PAGES.iterdir() if (p / "src.pdf").exists()}
        # ⚠️ 문항이 추출된 시험지만 센다. 아직 OCR 안 된 편을 섞으면 비교 대상이
        #    빈 집합이라 붙은 그림이 전부 '언급 없음'으로 잡힌다(첫 측정에서 겪음).
        cands = [
            eid
            for eid, src, n in con.execute(
                "select e.id, e.src_path,"
                " (select count(*) from questions q where q.exam_id=e.id)"
                " from exams e where e.src_path is not null"
            )
            if n > 0 and str(eid) in cached and "완료" in (src or "")
        ]
        random.seed(3)
        picked = random.sample(cands, min(a.batch, len(cands)))
        tw = tm = tx = 0
        fails = 0
        for eid in picked:
            try:
                w, m, x = run_one(eid, None)
            except Exception as exc:  # noqa: BLE001
                fails += 1
                print("  ! %d %s" % (eid, type(exc).__name__))
                continue
            tw += w
            tm += m
            tx += x
        print("── 그림↔문항 매칭 정확도 (완료본 %d편) ──" % len(picked))
        print("본문이 그림을 가리키는 문항 %d" % tw)
        print("그중 그림을 붙인 문항     %d (%.1f%%)" % (tm, tm * 100.0 / max(1, tw)))
        print("본문에 언급 없는데 붙음   %d" % tx)
        if fails:
            print("실패 %d편" % fails)
        return

    if not a.exam:
        raise SystemExit("exam_id 또는 --batch 를 주세요")
    w, m, x = run_one(a.exam, pathlib.Path(a.save) if a.save else None)
    print("시험지 %d — 그림 언급 문항 %d · 매칭 %d · 언급없이 붙음 %d" % (a.exam, w, m, x))
    if a.save:
        print("→", a.save)


if __name__ == "__main__":
    main()
