# -*- coding: utf-8 -*-
"""보기 번호 ↔ 그림 짝을 **원본 PDF 에서 되찾는다** (읽기 전용 · 드라이런).

왜 되찾을 수 있나
-----------------
DB 본문에는 `[그림]` 이라는 날 문자열만 남아 어느 그림이 ①인지 알 수 없다. 그런데
그림 파일을 만든 `scripts/figure/map-figures.py` 는 **좌표(rect)를 계산한 뒤 버렸고**,
본문을 만든 testchanger `db/textlayer.py` 도 figure 블록에 **bbox 를 실어 보냈는데**
우리 `src/lib/import/blocksToLatex.ts` 가 `[그림]` 문자열로 납작하게 만들며 버렸다.
원본 PDF 에는 ①②③④⑤ 가 **텍스트 레이어에 좌표째로** 살아 있다. 그래서 짝은
「버려진 것」이지 「없던 것」이 아니다.

이 도구가 지키는 것
-------------------
1. **파일과 묶인다.** 그림 목록은 `map-figures.map_exam` 을 그대로 불러 얻는다 —
   `extract-all-figures.py` 가 `q<번호>_<i>` 로 저장할 때 쓴 **바로 그 순서**다.
   그리고 그 바이트의 md5 를 `public/figures` 의 실제 파일과 대조한다(`묶임`).
   대조가 깨지면 그 문항은 **짝을 내지 않는다** — 순서가 달라졌다는 뜻이다.
2. **열쇠를 둘 쓰고, 둘이 어긋나면 «사람확인» 으로 내린다.**
   ㉮ 순서 — 읽기 순서로 k번째 마커 ↔ k번째 그림
   ㉯ 기하 — 그림마다 «같은 단에서 왼쪽·위에 붙은» 마커
   하나로만 판정하면 두 열 배치(① ② 가 한 줄, 그림이 그 아래)에서 조용히 틀린다.
3. **«미분류» 를 낸다.** 규칙에 안 걸리는 부류를 0으로 만들지 않는다.
4. **쓰기 경로가 없다.** 산출은 JSON 한 개뿐이다(D-31).

사용:
  python scripts/qa/choice_figure_recover.py --in  scripts/qa/reports/choice-figure-candidates.json \
                                             --out scripts/qa/reports/choice-figure-pairs.json
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import io
import json
import pathlib
import re
import sys

import fitz

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
_spec = importlib.util.spec_from_file_location(
    "mapfig", ROOT / "scripts" / "figure" / "map-figures.py"
)
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CIRCLED = "①②③④⑤"
# 줄머리 `1.` ~ `5.` — 원문자를 안 쓰는 시험지가 있다(실측).
LINE_MARK = re.compile(r"^\s*([1-5])\s*[.)]\s")
# 같은 줄로 볼 세로 허용치. 보기 마커는 그림보다 살짝 위에 앉는다.
ROW_TOL = 6.0
# 마커가 그림보다 이만큼까지 위에 있어도 «그 그림의 마커» 로 본다.
ABOVE_TOL = 40.0
# 마커가 그림 왼쪽 경계보다 이만큼 오른쪽에 있어도 허용(가운데 정렬 그림).
RIGHT_TOL = 12.0


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def page_markers(page) -> list[dict]:
    """이 쪽의 보기 마커 — (단, y, x, 번호). 원문자와 줄머리 숫자 둘 다."""
    W = page.rect.width
    mid = W / 2
    out: list[dict] = []
    raw = page.get_text("rawdict")
    for blk in raw.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for line in blk.get("lines", []):
            chars = [
                ch
                for sp in line.get("spans", [])
                for ch in sp.get("chars") or []
            ]
            if not chars:
                continue
            text = "".join(ch["c"] for ch in chars)
            for ch in chars:
                if ch["c"] in CIRCLED:
                    b = ch["bbox"]
                    out.append(
                        {
                            "n": CIRCLED.index(ch["c"]) + 1,
                            "x": b[0],
                            "y": b[1],
                            "col": 0 if b[0] < mid else 1,
                            "kind": "circled",
                        }
                    )
            m = LINE_MARK.match(text)
            if m:
                b = chars[0]["bbox"]
                out.append(
                    {
                        "n": int(m.group(1)),
                        "x": b[0],
                        "y": b[1],
                        "col": 0 if b[0] < mid else 1,
                        "kind": "line",
                    }
                )
    return out


def reading_key(col: float, y: float, x: float) -> tuple:
    """읽기 순서 — 단 → 줄(밴드) → 가로. 밴드로 묶어야 `① ②` 한 줄이 안 뒤집힌다."""
    return (col, round(y / ROW_TOL), x)


def choice_run(marks: list[dict]) -> list[dict]:
    """마커 후보에서 **보기 줄 1,2,3,…** 을 이루는 가장 긴 연속을 고른다.

    왜 그냥 «번호별 첫 것» 이 아닌가: 발문에도 원문자가 나온다 —
    `①∼⑤에 알맞은 수로 옳지 않은 것은?`(실측 5427 2번). 번호별로 첫 것을 잡으면
    발문의 ① 을 보기 ① 로 읽는다. 보기 마커는 읽기 순서로 **1부터 1씩** 이어지므로,
    그 성질을 그대로 열쇠로 쓴다. 같은 길이면 **뒤에 있는 것**을 택한다(보기는 발문 뒤).
    """
    order = sorted(marks, key=lambda m: (m["page"], reading_key(m["col"], m["y"], m["x"])))
    best: list[dict] = []
    for s in range(len(order)):
        if order[s]["n"] != 1:
            continue
        run = [order[s]]
        want = 2
        for t in range(s + 1, len(order)):
            if order[t]["n"] == want:
                run.append(order[t])
                want += 1
        if len(run) >= len(best):
            best = run
    return best


def question_region(page, qnum: int) -> tuple | None:
    """이 쪽에서 문항 qnum 이 차지하는 (시작(col,y), 끝(col,y)). 없으면 None."""
    anchors, _ = mapfig._page_layout(page)
    anchors = sorted(anchors, key=lambda a: (a[0], a[1]))
    for i, a in enumerate(anchors):
        if a[2] != qnum:
            continue
        start = (a[0], a[1])
        end = (
            (anchors[i + 1][0], anchors[i + 1][1])
            if i + 1 < len(anchors)
            else (99, 1e9)
        )
        return start, end
    return None


def geometric_owner(fig: dict, marks: list[dict]) -> int | None:
    """그림에 «붙은» 마커 — 같은 단에서 왼쪽. 없으면 None.

    ⚠️ «같은 줄»이 «바로 위»를 **반드시 이긴다**. 처음엔 세로 거리만으로 골랐는데,
    보기 그림이 세로로 길면(99px) **윗줄 마커가 더 가까워서** 그쪽이 이겼다 —
    사동중 21번에서 ③④⑤ 그림이 ①②③ 을 받았다(중복 배정). 거리는 같은 등급
    안에서만 따진다.
    """
    x0, y0, x1, y1 = fig["rect"]
    col = fig["col"]
    best = None
    for m in marks:
        if m["col"] != col:
            continue
        if m["x"] > x0 + RIGHT_TOL:
            continue  # 마커가 그림 오른쪽이면 그 그림의 것이 아니다
        same_row = y0 - ROW_TOL <= m["y"] <= y1
        just_above = y0 - ABOVE_TOL <= m["y"] < y0
        if not (same_row or just_above):
            continue
        d = (0 if same_row else 1, abs(m["y"] - y0), x0 - m["x"])
        if best is None or d < best[0]:
            best = (d, m["n"])
    return best[1] if best else None


def row_order(figs: list[dict]) -> list[dict]:
    """그림을 **줄로 묶어** 읽기 순서로 늘어놓는다 (단 → 줄 → 가로).

    ⚠️ 고정 밴드(`y/6`)로 묶으면 안 된다. 한 줄에 나란한 보기 그림도 높이·정렬이
    달라 위끝이 6px 넘게 차이 난다 — 그래서 `③ ④` 가 뒤집혔고, 짝이 맞는데도
    «두 열쇠가 어긋난다» 로 18건이 떨어졌다. 세로 **겹침**으로 묶으면 사라진다.
    """
    out: list[dict] = []
    for col in sorted({f["col"] for f in figs}):
        same = sorted(
            [f for f in figs if f["col"] == col], key=lambda f: f["rect"][1]
        )
        rows: list[list[dict]] = []
        for f in same:
            y0, y1 = f["rect"][1], f["rect"][3]
            placed = False
            for row in rows:
                ry0 = min(g["rect"][1] for g in row)
                ry1 = max(g["rect"][3] for g in row)
                overlap = min(y1, ry1) - max(y0, ry0)
                if overlap > 0.5 * min(y1 - y0, ry1 - ry0):
                    row.append(f)
                    placed = True
                    break
            if not placed:
                rows.append([f])
        rows.sort(key=lambda row: min(g["rect"][1] for g in row))
        for row in rows:
            out.extend(sorted(row, key=lambda f: f["rect"][0]))
    return out


FILE_QNUM = re.compile(r"^(hwp-)?q(\d+)")


def figure_qnum(urls: list[str]) -> tuple[int | None, bool]:
    """그림 **파일 이름**이 말하는 문항 번호와, HWP 에서 온 것인지.

    DB 의 `question_number` 를 믿으면 안 된다 — `scripts/figure/prune-figures.mjs`
    가 «오배치 그림을 주인 문항에 옮기는» 일을 하고, 그때 파일 이름은 **원래 문항의
    것 그대로**다(실측 5건: DB 2번 ↔ 파일 `q03_*`). 회수는 파일을 만든 쪽의 번호로
    해야 같은 그림에 닿는다.
    """
    if not urls:
        return None, False
    m = FILE_QNUM.match(urls[0].split("/")[-1])
    if not m:
        return None, False
    return int(m.group(2)), bool(m.group(1))


def recover_one(item: dict, figroot: pathlib.Path) -> dict:
    pdf = pathlib.Path(item["sourceFile"].replace("\\", "/"))
    qnum, from_hwp = figure_qnum(item["figureUrls"])
    out = {
        "id": item["id"],
        "examId": item["examId"],
        "questionNumber": item["questionNumber"],
        "figureQnum": qnum,
        "figureSource": "hwp" if from_hwp else "pdf",
        "figureUrls": item["figureUrls"],
        "verdict": "미분류",
        "why": "",
        "pairs": None,
    }
    if qnum is None:
        out["verdict"] = "불가"
        out["why"] = "그림 파일 이름에서 문항 번호를 못 읽는다"
        return out
    if from_hwp:
        # 그림을 HWP 원본에서 오려 온 문항이다(`scripts/figure/recover-hwp-figures.py`).
        # PDF 지면에는 그 그림이 없으므로 이 경로로는 못 짚는다 — 따로 센다.
        out["verdict"] = "불가"
        out["why"] = "그림이 HWP 에서 왔다 — PDF 지면 경로 아님"
        return out
    if not pdf.exists():
        out["verdict"] = "불가"
        out["why"] = "원본 없음"
        return out


    doc = fitz.open(pdf)
    try:
        mapped = mapfig.map_exam(pdf)
    except Exception as exc:  # noqa: BLE001
        doc.close()
        out["verdict"] = "불가"
        out["why"] = "map_exam 실패: %s" % type(exc).__name__
        return out
    figs_raw = mapped.get(qnum) or []
    if not figs_raw:
        doc.close()
        out["verdict"] = "불가"
        out["why"] = "원본에서 이 문항에 그림이 안 잡힌다"
        return out

    # ── ① 파일과 묶는다 — **이름의 첨자**로 묶고, 바이트로 확인한다 ──────────
    #
    # 위치(0,1,2…)로 묶으면 안 된다. `prune-figures.mjs` 가 오배치 그림을 떼어
    # DB 목록이 **부분집합**이 되어 있다(실측: 원본 `q03,q03_1..5` 6장 ↔ DB 5장).
    # 파일 이름의 첨자는 `extract-all-figures.py` 가 **원본 목록의 색인 그대로**
    # 붙인 것이라, 부분집합이어도 어느 그림인지 정확히 가리킨다.
    db_index: dict[int, str] = {}
    for url in item["figureUrls"]:
        name = url.split("/")[-1]
        m = re.match(r"^q\d+(?:_(\d+))?\.", name)
        if not m:
            doc.close()
            out["verdict"] = "불가"
            out["why"] = "그림 파일 이름 형식이 다르다 (%s)" % name
            return out
        db_index[int(m.group(1) or 0)] = url
    if max(db_index) >= len(figs_raw):
        doc.close()
        out["verdict"] = "불가"
        out["why"] = "이름 첨자가 원본 범위를 넘는다 (원본 %d장 · 최대 첨자 %d)" % (
            len(figs_raw),
            max(db_index),
        )
        return out

    bound = 0
    for i, url in db_index.items():
        f = figs_raw[i]
        dest = figroot / url.replace("/figures/", "")
        if not dest.exists():
            continue
        try:
            if f["xref"]:
                data = doc.extract_image(f["xref"])["image"]
            else:
                x0, y0, x1, y1 = f["rect"]
                data = doc[f["page"]].get_pixmap(
                    clip=fitz.Rect(x0, y0, x1, y1), dpi=200
                ).tobytes("png")
        except Exception:  # noqa: BLE001
            continue
        if md5(data) == md5(dest.read_bytes()):
            bound += 1
    out["bound"] = bound
    out["dbIndex"] = sorted(db_index)
    if bound != len(db_index):
        doc.close()
        out["verdict"] = "불가"
        out["why"] = "파일 대조 실패 (%d/%d)" % (bound, len(db_index))
        return out

    # ── ② 문항 영역 안의 마커를 모은다 ────────────────────────────────────
    figs = []
    for i, f in enumerate(figs_raw):
        x0, y0, x1, y1 = f["rect"]
        page = doc[f["page"]]
        mid = page.rect.width / 2
        figs.append(
            {
                "i": i,
                "page": f["page"],
                "rect": f["rect"],
                "col": 0 if (x0 + x1) / 2 < mid else 1,
            }
        )
    # 마커는 **그림 곁에 있는 것만** 본다.
    #
    # ⚠️ 처음엔 `question_region`(문항 번호 앵커)으로 걸렀다. **틀렸다.** 그림 파일의
    #    문항 번호와 지면에 인쇄된 번호가 어긋나는 편이 있어(실측 5건, `prune` 이 옮긴 것)
    #    엉뚱한 문항의 구간이 잡히고, 거기 있던 **다른 문항의 ①~⑤**(글자 보기)가
    #    보기 마커로 뽑혔다. 그러면 그림에는 아무 마커도 안 붙어 «보기가 글자다» 가 된다
    #    (압량중 2번 · 상원중 2번 등 13건). 번호를 믿지 말고 **그림의 자리**를 믿는다.
    MARK_ABOVE = 60.0
    MARK_BELOW = 10.0
    marks: list[dict] = []
    for pno in sorted({f["page"] for f in figs}):
        here = [f for f in figs if f["page"] == pno]
        cols = {f["col"] for f in here}
        lo = min(f["rect"][1] for f in here) - MARK_ABOVE
        hi = max(f["rect"][3] for f in here) + MARK_BELOW
        for m in page_markers(doc[pno]):
            if m["col"] not in cols or not (lo <= m["y"] <= hi):
                continue
            marks.append(dict(m, page=pno))
    doc.close()

    marks = choice_run(marks)
    out["markers"] = [m["n"] for m in marks]

    if not marks:
        out["verdict"] = "불가"
        out["why"] = "원본에도 보기 마커가 없다"
        return out

    figs_sorted = []
    for pno in sorted({f["page"] for f in figs}):
        figs_sorted.extend(row_order([f for f in figs if f["page"] == pno]))

    # ── ③ 발문 그림과 보기 그림을 가른다 ──────────────────────────────────
    #
    # 브리프는 «5장짜리가 발문1+보기4 인지 보기5 인지 가르는 열쇠가 없다» 고 적었다.
    # 원본 지면에는 있다 — **마커가 붙지 않는 그림이 발문 그림**이다.
    # 본문(DB)이 아니라 지면 좌표로 가르므로 본문 훼손과 무관하다.
    #
    # ⚠️ 처음엔 «첫 마커보다 읽기 순서로 앞이면 발문» 으로 갈랐다. **틀렸다.**
    #    보기 그림은 세로로 길어(실측 99px) 라벨이 그림의 **중간 높이**에 앉는다 —
    #    그림 위끝(y0)이 마커보다 위라서 보기 그림 셋이 통째로 «발문» 이 됐다
    #    (사동중 21번 exam 5769: 발문 1장인데 3장으로 셌다). 세로 위치로 가르면
    #    안 되고, «마커가 붙는가» 로 갈라야 한다.
    key_geom = {}
    for f in figs_sorted:
        same_page = [m for m in marks if m["page"] == f["page"]]
        owner = geometric_owner(f, same_page)
        if owner is not None:
            key_geom[f["i"]] = owner

    stem = [f for f in figs_sorted if f["i"] not in key_geom]
    choice_figs = [f for f in figs_sorted if f["i"] in key_geom]
    out["stem"] = [f["i"] for f in stem]

    # ── ④ 열쇠 둘이 맞는지 ────────────────────────────────────────────────
    #
    # 기하가 낸 배정을 **읽기 순서**로 늘어놓으면 마커 열과 글자 그대로 같아야 한다.
    # 이 한 줄이 개수·전단사·단조·번호까지 한꺼번에 본다 — 한 칸씩 밀린 배정
    # (그림마다 «위 마커»를 잡는 부류)은 마지막 번호에서 어긋나 반드시 걸린다.
    key_order = {}
    if len(marks) == len(choice_figs):
        for k, f in enumerate(choice_figs):
            key_order[f["i"]] = marks[k]["n"]

    out["byOrder"] = key_order or None
    out["byGeometry"] = key_geom or None

    if not choice_figs:
        out["verdict"] = "불가"
        out["why"] = "보기 자리에 그림이 없다 (보기가 글자다)"
        return out
    if len(marks) != len(choice_figs):
        out["verdict"] = "사람확인"
        out["why"] = "마커 %d개 · 보기 그림 %d장 (발문 %d장)" % (
            len(marks),
            len(choice_figs),
            len(stem),
        )
        out["pairs"] = key_geom
        return out
    if [key_geom[f["i"]] for f in choice_figs] != [m["n"] for m in marks]:
        out["verdict"] = "사람확인"
        out["why"] = "두 열쇠가 어긋난다"
        out["pairs"] = None
        return out

    # DB 가 그림을 부분집합으로 갖고 있으면(prune 이 뗐다) 짝은 되찾아도
    # **보기 한 자리가 비어 있다** — 학생은 여전히 못 고른다. 따로 센다.
    missing = [f["i"] for f in choice_figs if f["i"] not in db_index]
    if missing:
        out["verdict"] = "사람확인"
        out["why"] = "짝은 되찾았으나 보기 그림 %d장이 DB 에 없다" % len(missing)
        out["pairs"] = {i: n for i, n in key_order.items() if i in db_index}
        out["missingChoiceFigures"] = missing
        return out

    # ── ⑤ DB 본문과 어긋나면 «자동» 을 주지 않는다 (출처가 다른 두 증거) ─────
    #
    # 원본 지면만 보면 «이 그림들에 ①~⑤ 가 붙어 있다» 까지만 알 수 있다. 그 그림이
    # **이 문항의 것인지**는 모른다. 실제로 경일여중 14번은 앞 문항(13번)의 보기 그림
    # 다섯이 통째로 딸려 온 행이었고, 이 규칙은 그것을 «자동» 으로 짝지었다 —
    # 반대쪽 표본을 대 보지 않았으면 못 잡았을 오류다.
    #
    # DB 본문이 «보기는 글자 다섯» 이라고 말하는데 원본이 «보기는 그림» 이라고 하면
    # 둘 중 하나가 틀린 것이다. 어느 쪽인지는 **사람이** 정한다.
    if item.get("klass") and item["klass"] != "보기그림":
        out["verdict"] = "사람확인"
        out["why"] = "원본은 «보기가 그림» 인데 DB 본문은 «%s» 다 — 어긋난다" % item["klass"]
        out["pairs"] = key_order
        return out

    out["verdict"] = "자동"
    out["why"] = "발문 %d장 + 보기 %d장" % (len(stem), len(choice_figs))
    out["pairs"] = key_order
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--figroot", default="public/figures")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()

    items = json.loads(pathlib.Path(a.inp).read_text(encoding="utf-8"))
    if a.limit:
        items = items[: a.limit]
    figroot = pathlib.Path(a.figroot)

    results = []
    tally = collections.Counter()
    why = collections.Counter()
    for it in items:
        if not it.get("sourceFile") or it.get("questionNumber") is None:
            r = {
                "id": it["id"],
                "verdict": "불가",
                "why": "원본 메타 없음",
                "figureUrls": it.get("figureUrls", []),
            }
        else:
            r = recover_one(it, figroot)
        results.append(r)
        tally[r["verdict"]] += 1
        if r["verdict"] != "자동":
            why[r["verdict"] + " · " + (r["why"] or "?")] += 1

    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.out).write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("── 보기 그림 짝 되찾기 (드라이런 · %d건) ──" % len(items))
    for k, v in tally.most_common():
        print("  %-6s %4d" % (k, v))
    print("  ── 사유")
    for k, v in why.most_common(20):
        print("     %4d  %s" % (v, k))
    print("→", a.out)


if __name__ == "__main__":
    main()
