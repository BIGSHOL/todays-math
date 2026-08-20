# -*- coding: utf-8 -*-
"""큐브수학 개념 3-1 진도북 쪽 장르 조사. 읽기만 한다.

사용: PYTHONIOENCODING=utf-8 python scripts/qa/probe-cube-jindo31.py
산출: scripts/qa/reports/cube-probe/jindo31-*
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("scripts/qa/reports/cube-probe")
OUT.mkdir(parents=True, exist_ok=True)

EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}


def decode_cube_digits(s: str) -> str:
    return "".join(EHSANG_DIGIT.get(ord(c), c) for c in s)


def classify(text: str, page: int, n_pages: int) -> str:
    t = text.replace(" ", "")
    # 순서가 중요하다. 한 쪽에 표지가 섞이면 앞 규칙이 이긴다.
    if page <= 2 and ("진도북" in t or re.search(r"3[\.·]1", t)):
        return "표지"
    if "차례" in text[:80] or "CONTENTS" in text[:80]:
        return "목차"
    if "학업성취도평가" in t or "학업 성취도 평가" in text:
        return "평가"
    if "단원마무리" in t:
        return "단원마무리"
    if "미리보는수학익힘" in t:
        return "수학익힘"
    if "기초력학습지" in t:
        return "학습지안내"  # 진도북 안에 매칭 안내가 있으면
    if "교과서개념잡기" in t or "한눈에핵심" in t:
        return "개념설명"
    if "개념확인하기" in t or "예제" in t[:200]:
        return "개념확인"
    if "실력다지기" in t:
        return "실력다지기"
    if "개념완성하기" in t:
        return "개념완성"
    if "생각해보기" in t or "탐구" in t[:120]:
        return "탐구"
    if "정답및풀이" in t and page > n_pages // 2:
        return "정답"
    if re.search(r"(?m)^\s*\d{1,2}\s*[\.)]\s", text) or re.search(
        r"(?m)^\s*\d{2}\s+", text
    ):
        # 번호만으로 단정하지 않는다 — 개념설명에도 예 ① 이 있다.
        if "하세요" in text or "구하세요" in text or "써넣" in text:
            return "연습후보"
    if "하세요" in text and page > 4:
        return "연습후보"
    return "기타"


def head_lines(text: str, n: int = 12) -> list[str]:
    out = []
    for ln in text.splitlines():
        s = ln.strip()
        if s:
            out.append(s)
        if len(out) >= n:
            break
    return out


def main() -> None:
    doc = pymupdf.open(PDF)
    n = doc.page_count
    print(f"file={PDF.name} pages={n}")
    rows = []
    genres: Counter[str] = Counter()
    samples_by_genre: dict[str, list[int]] = {}
    for i in range(n):
        page = doc[i]
        raw = page.get_text() or ""
        dec = decode_cube_digits(raw)
        genre = classify(dec, i + 1, n)
        genres[genre] += 1
        rec = {
            "page": i + 1,
            "genre": genre,
            "chars": len(dec),
            "images": len(page.get_images()),
            "head": head_lines(dec),
        }
        rows.append(rec)
        samples_by_genre.setdefault(genre, [])
        if len(samples_by_genre[genre]) < 3:
            samples_by_genre[genre].append(i + 1)
    print("── 장르 ──")
    for g, c in genres.most_common():
        print(f"  {c:4}  {g}  표본={samples_by_genre[g]}")

    # 장르당 표본 PNG
    rendered = []
    for g, pages in samples_by_genre.items():
        for pno in pages:
            pix = doc[pno - 1].get_pixmap(dpi=100)
            name = f"jindo31-{g}-p{pno}.png"
            pix.save(str(OUT / name))
            rendered.append(name)
    doc.close()

    (OUT / "jindo31-pages.json").write_text(
        json.dumps({"pages": n, "genres": dict(genres), "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    lines = [f"pages={n}", "genres:"]
    for g, c in genres.most_common():
        lines.append(f"  {c:4}  {g}")
    lines.append("\n── 쪽별 ──")
    for r in rows:
        h = " | ".join(r["head"][:6])
        lines.append(f"p{r['page']:03} {r['genre']:8} c={r['chars']:4} img={r['images']:3}  {h}")
    (OUT / "jindo31-survey.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote jindo31-survey.txt  png={len(rendered)}")


if __name__ == "__main__":
    main()
