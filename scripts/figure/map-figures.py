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

IDX = r"D:\시험지 한글화\db\exam_index.db"
PAGES = pathlib.Path(r"D:\시험지 한글화\db\pages")

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


def map_exam(pdf: pathlib.Path) -> dict[int, list[dict]]:
    """{문항번호: [{page, xref, rect}]}"""
    doc = fitz.open(pdf)
    result: dict[int, list[dict]] = collections.defaultdict(list)
    current = None

    for pno in range(doc.page_count):
        page = doc[pno]
        W = page.rect.width
        raw = page.get_text("rawdict")
        # 이미지 블록에는 xref 가 없다 — bbox 로 되찾는다.
        xref_by_rect = {}
        for im in page.get_images(full=True):
            for r in page.get_image_rects(im[0]):
                xref_by_rect[(round(r.x0), round(r.y0), round(r.x1), round(r.y1))] = im[0]

        for blk in raw.get("blocks", []):
            if blk.get("type") == 0:
                m = QNUM.match(first_line_text(blk))
                if m:
                    n = int(m.group(1))
                    # 번호는 1부터 올라간다. 되돌아가면 정답면이거나 오검출이다.
                    if current is None or n == current + 1 or n > current:
                        current = n
                continue

            # 이미지 블록
            x0, y0, x1, y1 = blk.get("bbox", (0, 0, 0, 0))
            w, h = x1 - x0, y1 - y0
            if pno == 0 and y0 < 110 and w > W * 0.6:
                continue  # 머리 배너(로고)
            if w < 24 or h < 24:
                continue
            if current is None:
                continue
            result[current].append(
                {
                    "page": pno,
                    "xref": xref_by_rect.get((round(x0), round(y0), round(x1), round(y1))),
                    "rect": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                }
            )
    doc.close()
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
