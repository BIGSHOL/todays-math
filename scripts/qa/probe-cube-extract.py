# -*- coding: utf-8 -*-
"""큐브수학 파일럿: PUA 복원 · 시험지 extract() 적합성 · 정답면 위치.

공유 DB 에 쓰지 않는다. 산출은 scripts/qa/reports/cube-probe/ 만.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path("scripts/qa").resolve()))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.insert(0, str(TC))
sys.path.insert(0, str(TC / "db"))
import textlayer  # noqa: E402
import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념")
OUT = Path("scripts/qa/reports/cube-probe")
OUT.mkdir(parents=True, exist_ok=True)

BOOKS = {
    "응용강화-5-2": ROOT / "큐브수학 개념응용" / "응용강화북" / "큐브수학 개념응용 5-2 응용강화북.pdf",
    "매칭-개념-4-2": ROOT / "큐브수학 개념" / "매칭북" / "큐브수학 개념 4-2_매칭북.pdf",
    "진도-개념-5-2": ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 5-2_진도북.pdf",
    "정답-실력-3-1": ROOT / "큐브수학 실력" / "3-1 큐브실력" / "큐브수학실력3-1정답(01~64).pdf",
    "매칭-실력-3-1": ROOT / "큐브수학 실력" / "3-1 큐브실력" / "큐브수학 실력 3-1_매칭북.pdf",
}


def pua_count(s: str) -> int:
    return sum(1 for c in s if 0xE000 <= ord(c) <= 0xF8FF)


def page_preview(path: Path, pages: list[int], tag: str) -> None:
    doc = pymupdf.open(path)
    lines = [f"# {path.name} pages={doc.page_count}"]
    for pno in pages:
        if pno < 1 or pno > doc.page_count:
            continue
        page = doc[pno - 1]
        raw = page.get_text() or ""
        dec = textlayer.decode(raw)
        lines.append(f"\n===== p{pno} raw_pua={pua_count(raw)} dec_pua={pua_count(dec)} chars={len(dec)} =====")
        lines.append(dec[:1800])
        pix = page.get_pixmap(dpi=110)
        png = OUT / f"{tag}-p{pno}.png"
        pix.save(str(png))
        lines.append(f"[png {png.name}]")
    doc.close()
    (OUT / f"{tag}-decoded.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {tag}-decoded.txt")


def try_extract(path: Path, tag: str) -> dict:
    rec = {"tag": tag, "file": path.name, "ok": False}
    try:
        doc, answers = textlayer.extract(path, with_answers=True)
    except Exception as e:
        rec["error"] = f"{type(e).__name__}: {e}"[:300]
        print(f"extract {tag} FAIL {rec['error']}")
        return rec
    qs = doc.get("questions") or []
    rec.update(
        {
            "ok": True,
            "header": (doc.get("header") or {}).get("title"),
            "questions": len(qs),
            "numbers": [q.get("number") for q in qs[:30]],
            "types": {q.get("type"): 0 for q in qs},
            "answers": len(answers or []),
            "answerNums": [a.get("number") for a in (answers or [])[:20]],
            "pua": pua_count(json.dumps(doc, ensure_ascii=False)),
        }
    )
    for q in qs:
        rec["types"][q.get("type")] = rec["types"].get(q.get("type"), 0) + 1
    # 첫 3문항 본문만 짧게
    samples = []
    for q in qs[:3]:
        blocks = q.get("contents") or []
        text = " ".join(
            str(b.get("text") or b.get("content") or b)[:80] for b in blocks[:6]
        )
        samples.append({"n": q.get("number"), "type": q.get("type"), "text": text[:240]})
    rec["samples"] = samples
    print(
        f"extract {tag} qs={rec['questions']} ans={rec['answers']} "
        f"nums={rec['numbers'][:12]} pua={rec['pua']}"
    )
    return rec


def scan_answer_hints(path: Path) -> dict:
    """쪽마다 '정답 N쪽' · '정답 및 풀이' 출현을 센다."""
    doc = pymupdf.open(path)
    hits = []
    for i in range(doc.page_count):
        t = textlayer.decode(doc[i].get_text() or "")
        if "정답" in t or "풀이" in t:
            hits.append(
                {
                    "page": i + 1,
                    "has정답": "정답" in t,
                    "has풀이": "풀이" in t,
                    "hint": re.findall(r"정답\s*\d+쪽", t)[:3],
                }
            )
    n = doc.page_count
    doc.close()
    return {"pages": n, "hits": hits[:40], "hitCount": len(hits)}


def count_problem_heads(path: Path) -> dict:
    """응용강화 스타일: 쪽마다 큰 '1.' '2.' 가 다시 시작한다."""
    doc = pymupdf.open(path)
    restart = 0
    seq = 0
    last = 0
    per_page = []
    for i in range(doc.page_count):
        t = textlayer.decode(doc[i].get_text() or "")
        nums = [int(m) for m in re.findall(r"(?m)^(\d{1,2})\.\s", t)]
        # 줄머리만이 아니라 본문에도 있어 느슨하게도 센다
        loose = [int(m) for m in re.findall(r"(?:^|\n)(\d{1,2})\.\s", t)]
        per_page.append({"page": i + 1, "bol": nums[:8], "loose": loose[:12]})
        for n in loose:
            if n == 1:
                restart += 1
            if last and n == last + 1:
                seq += 1
            last = n
    doc.close()
    return {"restartsAt1": restart, "consecutiveSteps": seq, "pages": per_page[:30]}


def main() -> None:
    report: dict = {}
    # 1) PUA 복원 눈으로 보기
    page_preview(BOOKS["응용강화-5-2"], [1, 2, 10, 20, 21, 22, 23, 24], "app52")
    page_preview(BOOKS["매칭-개념-4-2"], [1, 36, 37, 38, 64], "match42")
    page_preview(BOOKS["진도-개념-5-2"], [28, 29, 30, 140, 150, 152], "prog52")
    page_preview(BOOKS["정답-실력-3-1"], [1, 2, 63, 64], "ans31")

    # 2) 시험지 extract() 가 이 교재에서 무엇을 내놓나
    extracts = []
    for tag, path in [
        ("응용강화-5-2", BOOKS["응용강화-5-2"]),
        ("매칭-개념-4-2", BOOKS["매칭-개념-4-2"]),
        ("정답-실력-3-1", BOOKS["정답-실력-3-1"]),
    ]:
        extracts.append(try_extract(path, tag))
    report["extract"] = extracts

    # 3) 정답 힌트 · 문항 번호 패턴
    for tag, path in BOOKS.items():
        print(f"scan {tag}")
        report[f"hints:{tag}"] = scan_answer_hints(path)
        report[f"heads:{tag}"] = count_problem_heads(path)

    (OUT / "extract-test.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote extract-test.json")


if __name__ == "__main__":
    main()
