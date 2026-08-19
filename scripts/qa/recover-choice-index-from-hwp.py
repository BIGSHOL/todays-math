# -*- coding: utf-8 -*-
"""보기 그림 짝을 **HWPX 문단 흐름**에서 되찾는다. 토큰 0 · API 0.

    python scripts/qa/recover-choice-index-from-hwp.py            드라이런(집계)
    python scripts/qa/recover-choice-index-from-hwp.py --list     행마다 근거를 찍는다

입력 : `scripts/qa/reports/choice-figure-discard-lock.json` (출제 제외된 행 + 사유)
       `scripts/qa/reports/hwpx/<examId>.hwpx`
       `scripts/qa/reports/rows-choice-hwp.json` (DB 행 — `export-choice-rows.ts` 가 만든다)
출력 : `scripts/qa/reports/choice-figure-pairs-hwp.json` (apply-choice-figure-index.ts 형식)

## 왜 HWP 인가

PDF 지면 좌표로 ①②③④⑤ 를 찾는 길(`choice_figure_recover.py`)이 97건을 되찾았는데,
**그 길이 못 닿는 19행**이 남았다. 그림이 PDF 지면이 아니라 **HWP BinData** 에서 온
행들이라 지면 좌표가 애초에 없다.

HWPX 는 다르다 — `<hp:pic>` 이 문단 흐름 안에 있어서 **문서 순서가 곧 보기 순서**다.
실측 3802-4 의 흐름: 마커 ① 다음에 그림, ② 다음에 그림 … 이 그대로 나온다.

## 순서를 «가정» 하지 않는다

`recover-hwp-figures.py` 가 파일을 만든 순서가 문서 순서와 같을 **것 같지만**, 그건
추론이지 사실이 아니다. 그래서 BinData 를 **같은 방식으로 PNG 로 바꿔 바이트 md5** 를
디스크의 파일과 대조한다 — 순서가 문항마다 **확인되는 사실**이 된다
(CLAUDE.md 2026-08-18 「순서를 가정하지 않는 법」).

## 못 가르면 통째로 «모른다»

`choiceFigureIndex.ts` 의 규약대로 반쪽은 안 받는다. 아래 중 하나라도 걸리면 건너뛴다:
  · DB 그림 중 흐름에서 짝을 못 찾은 것이 있다
  · 같은 보기 번호가 둘 이상이다
  · **기록된 정답이 흐름에서 센 보기 수를 넘는다** — 본문 밖의 반증이다
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import fitz

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append("scripts/vendor/testchanger")
import hwp_extract as HX  # noqa: E402

HP = HX.HP
HWPX = pathlib.Path("scripts/qa/reports/hwpx")
LOCK = pathlib.Path("scripts/qa/reports/choice-figure-discard-lock.json")
ROWS = pathlib.Path("scripts/qa/reports/rows-choice-hwp.json")
OUT = pathlib.Path("scripts/qa/reports/choice-figure-pairs-hwp.json")
#: 이 사유로 잠긴 행만 본다. PDF 지면 경로가 못 닿은 부류다.
REASON = "그림이 HWP 에서 왔다 — PDF 지면 경로 아님"
MARKERS = "①②③④⑤⑥⑦⑧⑨⑩"


def walk(node, out: list) -> None:
    for child in node:
        if child.tag in HX._SKIP_CTRL:
            continue
        tag = child.tag.split("}")[-1]
        if child.tag == HP + "endNote":
            out.append(("endnote", ""))
            continue
        if tag == "pic":
            ref = ""
            for c in child.iter():
                if c.tag.split("}")[-1] == "img":
                    ref = (c.attrib.get("binaryItemIDRef") or "").lower()
            out.append(("pic", ref))
            continue
        if tag == "t":
            out.append(("t", "".join(child.itertext())))
            continue
        walk(child, out)


def flow(exam: str, number: int) -> list:
    """그 문항 구간의 (글자|그림) 을 문서 순서대로."""
    items: list = []
    with zipfile.ZipFile(HWPX / (exam + ".hwpx")) as z:
        for name in sorted(
            n for n in z.namelist() if re.match(r"Contents/section\d+\.xml", n)
        ):
            walk(ET.fromstring(z.read(name).decode("utf-8")), items)
    out, q = [], 0
    for kind, val in items:
        if kind == "endnote":
            q += 1
            if q > number:
                break
            continue
        if q == number:
            out.append((kind, val))
    return out


def bin_map(exam: str) -> dict:
    """binaryItemIDRef -> (원본 바이트, 확장자)."""
    out: dict = {}
    with zipfile.ZipFile(HWPX / (exam + ".hwpx")) as z:
        for n in z.namelist():
            if not n.lower().startswith("bindata/"):
                continue
            out[pathlib.Path(n).stem.lower()] = (
                z.read(n),
                pathlib.Path(n).suffix.lstrip("."),
            )
    return out


def to_png(data: bytes, ext: str) -> bytes:
    """`recover-hwp-figures.to_png` 와 **같은 규약**이어야 md5 가 맞는다."""
    img = fitz.open(stream=data, filetype=ext)
    pdf = fitz.open("pdf", img.convert_to_pdf())
    return pdf[0].get_pixmap(dpi=72).tobytes("png")


def assign(items: list):
    """흐름을 훑어 그림마다 «몇 번 보기인가»를 매긴다. (그림목록, 본 보기 수).

    보기 마커를 만나면 그 뒤의 그림은 그 보기의 것이다. 마커 이전의 그림은 발문(0).
    ⚠️ 마커가 **글자 보기**를 가질 수도 있다(실측 3675-5 의 ⑤ 는 「수직선 위에
    나타낼 수 없다」). 그래서 «그림이 붙은 마커 수»가 아니라 **본 마커의 최댓값**을 센다.
    """
    cur, pics, seen = 0, [], 0
    for kind, val in items:
        if kind == "t":
            for ch in val:
                i = MARKERS.find(ch)
                if i >= 0:
                    cur = i + 1
                    seen = max(seen, cur)
        elif kind == "pic" and val:
            pics.append((val, cur))
    return pics, seen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    lock = json.loads(LOCK.read_text(encoding="utf-8"))["이전상태"]
    targets = {}
    for r in lock:
        if r["사유"] == REASON:
            targets[r["externalId"]] = r
    rows = {}
    for r in json.loads(ROWS.read_text(encoding="utf-8")):
        rows[r["externalId"]] = r

    plan, skip = [], {}

    def bump(why: str) -> None:
        skip[why] = skip.get(why, 0) + 1

    for eid in sorted(targets):
        exam = eid.split("-")[0]
        row = rows.get(eid)
        if row is None:
            bump("DB 행을 못 찾았다")
            continue
        if not (HWPX / (exam + ".hwpx")).exists():
            bump("hwpx 가 아직 없다 (HWP 추출 필요)")
            continue
        number = row.get("hwpNumber") or row.get("questionNumber")
        items = flow(exam, int(number))
        pics, seen = assign(items)
        if not pics:
            bump("흐름에 그림이 없다")
            continue

        # ── 순서를 «확인» 한다: BinData -> PNG -> md5 <-> 디스크 파일
        bins = bin_map(exam)
        digest = {}
        for ref, _n in pics:
            if ref not in bins:
                continue
            try:
                digest[ref] = hashlib.md5(to_png(*bins[ref])).hexdigest()
            except Exception:  # noqa: BLE001
                pass
        index, unmatched = [], 0
        for url in row["figureUrls"]:
            f = pathlib.Path("public" + url)
            if not f.exists():
                unmatched += 1
                index.append(-1)
                continue
            md5 = hashlib.md5(f.read_bytes()).hexdigest()
            hit = [n for ref, n in pics if digest.get(ref) == md5]
            if len(hit) != 1:
                unmatched += 1
                index.append(-1)
            else:
                index.append(hit[0])
        if unmatched:
            bump("DB 그림과 HWP 그림이 바이트로 안 맞는다")
            if a.list:
                print("  X " + eid + " 짝 못 지은 그림 "
                      + str(unmatched) + "/" + str(len(row["figureUrls"])))
            continue

        nums = [n for n in index if n > 0]
        if len(nums) != len(set(nums)):
            bump("같은 보기 번호가 둘 이상이다")
            continue
        # 본문 **밖**의 반증 — 기록된 정답이 본 보기 수를 넘으면 그 구조는 틀렸다.
        ans = (row.get("answer") or "").strip()
        ansnum = MARKERS.find(ans[0]) + 1 if ans and ans[0] in MARKERS else 0
        if ansnum and seen and ansnum > seen:
            bump("기록된 정답이 흐름의 보기 수를 넘는다")
            continue

        plan.append({
            "id": row["id"],
            "externalId": eid,
            "examId": exam,
            "questionNumber": row["questionNumber"],
            "figureUrls": row["figureUrls"],
            "verdict": "자동",
            "choiceFigureIndex": index,
            "why": ("HWP 문단 흐름 — 발문 " + str(index.count(0))
                    + "장 + 보기 " + str(len(nums)) + "장 (보기 " + str(seen) + "칸)"),
        })
        if a.list:
            print("  O " + eid + "  " + str(index)
                  + "  보기 " + str(seen) + "칸 · 정답 " + ans)

    OUT.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n대상 " + str(len(targets)) + "행 · 되찾음 " + str(len(plan)) + "행")
    for w in sorted(skip, key=lambda k: -skip[k]):
        print("  건너뜀: " + w + " " + str(skip[w]))
    if len(plan) + sum(skip.values()) != len(targets):
        raise SystemExit("분모가 안 맞는다 — 조용히 빠진 행이 있다")
    print("-> " + str(OUT))


if __name__ == "__main__":
    main()
