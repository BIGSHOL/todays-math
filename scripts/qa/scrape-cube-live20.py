# -*- coding: utf-8 -*-
"""화면에 있는 개념 3-1 무작위 20을 PDF 에서 다시 긁는다. 공유 DB 금지.

손본 `random20.ts` 와 숫자·한글을 견준다. textlayer.extract() 쓰지 않는다.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념")
PDF = ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 3-1_진도북.pdf"
TS = Path("src/app/dev/cube-scrape/random20.ts")
OUT = Path("scripts/qa/reports/cube-probe")
OUT_TS = Path("src/app/dev/cube-scrape/extract20.ts")

EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {
    **EHSANG_DIGIT,
    0x1E: "=",
    0x1F: "<",
    0x1D: ">",
    0x0E: "-",
    0x0C: "+",
    0x0040: "×",
    0x0096: "÷",
}

# extract-cube-jindo31.py 와 같은 자르기.
START_01 = re.compile(r"(?m)^((?:0[1-9]|[1-9]\d))\s+(\S)")
START_1 = re.compile(r"(?m)^([1-9])\s+(?=[가-힣□【\[])")


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


def leftover(s: str) -> list[str]:
    out = []
    for ch in s:
        o = ord(ch)
        if o < 32 and ch not in "\n\t\r":
            out.append(f"U+{o:04X}")
        elif 127 <= o < 160:
            out.append(f"U+{o:04X}")
    return out


def split_items(text: str) -> list[tuple[str, str]]:
    hits = [(m.start(), m.group(1)) for m in START_01.finditer(text)]
    if not hits:
        hits = [(m.start(), m.group(1)) for m in START_1.finditer(text)]
    items = []
    for i, (pos, num) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        body = text[pos:end].strip()
        if len(re.sub(r"\s+", "", body)) < 8:
            continue
        items.append((num, body))
    return items


def ts_ids() -> list[dict]:
    text = TS.read_text(encoding="utf-8")
    ids = re.findall(r'id:\s*"(cube-concept-3-1-p\d+-q[^"]+)"', text)
    pages = [int(x) for x in re.findall(r"page:\s*(\d+)", text)]
    contents = re.findall(r"content:\s*\n?\s*\"([^\"]*)\"|content:\s*`([^`]*)`", text)
    # contents from template strings
    contents = re.findall(r"content:\s*((?:`[^`]*`)|(?:\"[^\"]*\"))", text, re.S)
    recs = []
    for i, cid in enumerate(ids):
        m = re.search(r"p(\d+)-q(.+)$", cid)
        recs.append(
            {
                "id": cid,
                "page": int(m.group(1)) if m else pages[i] if i < len(pages) else 0,
                "number": m.group(2) if m else "",
                "curated": contents[i].strip("`\"") if i < len(contents) else "",
            }
        )
    return recs


def hangul_digits(s: str) -> str:
    return re.sub(r"[^0-9가-힣]", "", s)


def digits(s: str) -> list[str]:
    return re.findall(r"\d+", s)


def main() -> None:
    targets = ts_ids()
    if len(targets) != 20:
        raise SystemExit(f"random20 id {len(targets)} != 20")
    doc = pymupdf.open(PDF)
    pages: dict[int, str] = {}
    rows = []
    for t in targets:
        pno = t["page"]
        if pno not in pages:
            pages[pno] = decode(doc[pno - 1].get_text() or "")
        text = pages[pno]
        items = split_items(text)
        hit = next((body for num, body in items if num == t["number"] or num.lstrip("0") == t["number"].lstrip("0")), None)
        cur = t["curated"]
        cur_h = hangul_digits(cur)
        ext_h = hangul_digits(hit or "")
        cur_d = [d for d in digits(cur) if len(d) >= 2]
        missing = [d for d in cur_d if d not in (hit or "")]
        ctrl = leftover(hit or "")
        verdict = "없음"
        if hit:
            if missing:
                verdict = "번호만맞음" if not any(d in (hit or "") for d in cur_d[:3]) else "숫자빠짐"
            elif len(cur_h) >= 8 and cur_h[:8] not in ext_h and ext_h[:8] not in cur_h:
                verdict = "다른문항"
            else:
                verdict = "본문유사"
            # 두 단이 섞여 손본의 핵심 한글이 추출에 없으면 다른 문항
            core = re.findall(r"[가-힣]{3,}", cur)
            core = [w for w in core if w not in {"안에", "알맞은", "써넣으세요", "구하세요", "보세요"}]
            if core and hit and not any(w in hit for w in core[:3]):
                verdict = "다른문항"
        rows.append(
            {
                "id": t["id"],
                "page": pno,
                "number": t["number"],
                "verdict": verdict,
                "missingDigits": missing[:8],
                "controls": sorted(set(ctrl))[:8],
                "extract": hit,
                "nOnPage": len(items),
            }
        )
        print(f"{t['id']:40} {verdict:8} miss={missing[:4]} nPage={len(items)}")
    doc.close()

    counts = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    report = {
        "file": PDF.name,
        "n": len(rows),
        "verdicts": counts,
        "items": rows,
        "note": "개념 3-1 은 정답 PDF 가 이 폴더에 없다. 공유 DB 에 넣지 않았다.",
    }
    dest = OUT / "live20-scrape.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("verdicts", counts, "wrote", dest)

    # 화면용 TS — 추출 원문만.
    lines = [
        "/** PDF 에서 다시 긁은 원문. scrape-cube-live20.py 가 만든다. 적재하지 않았다. */",
        "export const CUBE_EXTRACT_20: { id: string; extract: string | null; verdict: string }[] = [",
    ]
    for r in rows:
        ext = json.dumps(r["extract"], ensure_ascii=False)
        lines.append(
            f'  {{ id: {json.dumps(r["id"], ensure_ascii=False)}, verdict: {json.dumps(r["verdict"], ensure_ascii=False)}, extract: {ext} }},'
        )
    lines.append("];")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", OUT_TS)


if __name__ == "__main__":
    main()
