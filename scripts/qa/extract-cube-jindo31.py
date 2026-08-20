# -*- coding: utf-8 -*-
"""큐브수학 개념 3-1 진도북 문항 파일럿. 공유 DB 에 쓰지 않는다.

쪽 장르를 가른 뒤 연습·단원마무리·평가만 쪼갠다. 개념 설명은 버린다.
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

EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
# 매칭북에서 덧셈으로 보인 자리. 진도북에서도 같은지 센다.
EHSANG_PLUS = {0x0C: "+"}
# p9·p24 실측: 331+247 뒤 · ◯ 안 비교. 한 칸 밀면 등호가 안 나온다.
# p28 실측: 781-254 · 742-521 의 뺄셈은 U+000E.
EHSANG_OP = {0x1E: "=", 0x1F: "<", 0x1D: ">", 0x0E: "-"}


def decode_cube(s: str) -> str:
    out = []
    for c in s:
        o = ord(c)
        if o in EHSANG_DIGIT:
            out.append(EHSANG_DIGIT[o])
        elif o in EHSANG_PLUS:
            out.append(EHSANG_PLUS[o])
        elif o in EHSANG_OP:
            out.append(EHSANG_OP[o])
        else:
            out.append(c)
    return "".join(out)


def leftover_controls(s: str) -> Counter[str]:
    c: Counter[str] = Counter()
    for ch in s:
        o = ord(ch)
        if o < 32 and ch not in "\n\t\r":
            c[f"U+{o:04X}"] += 1
        elif 127 <= o < 160:
            c[f"U+{o:04X}"] += 1
    return c


def classify(text: str, page: int) -> str:
    compact = re.sub(r"\s+", "", text)
    if page == 1:
        return "표지"
    if "구성과특징" in compact or "이렇게활용" in compact:
        return "안내"
    if page <= 5 and ("차례" in text or "기초력학습지" in compact and "매칭북" in compact):
        if "차례" in text[:40]:
            return "목차"
        return "안내"
    if "공부한날" in compact or "동영상강의와함께계획" in compact:
        return "계획표"
    if "창의력" in compact and ("단원마무리" in compact or "정답" in compact[:80]):
        return "창의력"
    if compact.startswith("학업성취도평가") or "학업성취도평가" in compact[:40]:
        return "평가"
    if "단원마무리" in compact[:80]:
        return "단원마무리"
    if "수학익힘" in compact and "문제잡기" in compact:
        return "수학익힘"
    if "서술형잡기" in compact or ("서술형" in compact[:60] and "풀이과정" in compact):
        return "서술형"
    if "교과서개념잡기" in compact and ("한눈에" in compact or "개념강의" in compact):
        return "개념설명"
    if "개념한번더잡기" in compact or "에서개념을한번더" in compact:
        return "개념한번더"
    if page in {6, 32, 54} or re.search(r"수학 3－1\s*$", text[-40:]):
        # 단원 도입 만화: 짧은 대사 + 단원명
        if len(text) < 200:
            return "단원도입"
    return "기타"


# 단원마무리·평가: 01 02 … / 개념한번더: 1 2 3 4 (뒤에 한글·□)
START_01 = re.compile(r"(?m)^((?:0[1-9]|[1-9]\d))\s+(\S)")
START_1 = re.compile(r"(?m)^([1-9])\s+(?=[가-힣□【\[])")
SUB = re.compile(r"^[⑴⑵⑶⑷⑸①②③④⑤]")


def split_items(text: str, genre: str) -> list[tuple[str, str]]:
    # 01·02 가 있으면 그걸 쓴다. 큰 1·2·3·4 만 있는 홀수 쪽은 1식으로 떨어진다.
    hits01 = [(m.start(), m.group(1)) for m in START_01.finditer(text)]
    if hits01:
        hits = hits01
    elif genre in {"개념한번더", "수학익힘", "서술형"}:
        hits = [(m.start(), m.group(1)) for m in START_1.finditer(text)]
    else:
        hits = []
    if not hits:
        return []
    items = []
    for i, (pos, num) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        body = text[pos:end].strip()
        # 번호 줄만 있고 본문이 너무 짧으면 헤더
        if len(re.sub(r"\s+", "", body)) < 8:
            continue
        items.append((num, body))
    return items


FIGURE_HINT = re.compile(
    r"수 모형|그림을 보고|도형을 보고|색칠|이어 보세요|그려 보세요|"
    r"◯표|○표|표시하|자 를|재어"
)
DRAW_ONLY = re.compile(r"그려 보세요|이어 보세요|색칠해 보세요|◯를 그려")
WORD = re.compile(r"구하세요|몇 (개|명|도막|cm|DN)")


def flags(body: str) -> list[str]:
    out = []
    if FIGURE_HINT.search(body):
        out.append("그림필요")
    if DRAW_ONLY.search(body):
        out.append("그리기")
    if "이어 보세요" in body or "같은 것끼리" in body:
        out.append("선잇기")
    if re.search(r"계산해 보세요", body) and not re.search(r"[+\-×÷+\-−]", body):
        # 세로셈은 기호가 선일 수 있다
        if not re.search(r"\n\s*[+\-]\s*\d", body):
            out.append("연산기호없음")
    leftover = leftover_controls(body)
    if leftover:
        out.append("제어문자")
    if WORD.search(body) and "그림필요" not in out:
        out.append("문장제")
    return out


def unit_hint(text: str) -> str | None:
    m = re.search(r"(\d)\.\s*([가-힣]{2,12})", text)
    if m and "하세요" not in m.group(2):
        return m.group(2)
    return None


def main() -> None:
    doc = pymupdf.open(PDF)
    n = doc.page_count
    raw_pages = []
    leftovers: Counter[str] = Counter()
    for i in range(n):
        raw = doc[i].get_text() or ""
        leftovers.update(leftover_controls(raw))
        dec = decode_cube(raw)
        raw_pages.append((i + 1, dec, classify(dec, i + 1)))
    doc.close()

    inherit_ok = {"개념한번더", "수학익힘", "서술형", "단원마무리", "평가"}
    stop_inherit = {
        "개념설명",
        "계획표",
        "안내",
        "표지",
        "목차",
        "단원도입",
        "창의력",
        "평가",
    }
    genres = [g for _, _, g in raw_pages]
    for i in range(1, len(genres)):
        if genres[i] == "기타" and genres[i - 1] in inherit_ok:
            if genres[i] not in stop_inherit:
                genres[i] = genres[i - 1]

    pages = []
    items = []
    for (pno, dec, _), genre in zip(raw_pages, genres):
        rec = {"page": pno, "genre": genre, "chars": len(dec)}
        if genre in inherit_ok:
            rec["unit"] = unit_hint(dec)
            split = split_items(dec, genre)
            rec["nItems"] = len(split)
            for num, body in split:
                items.append(
                    {
                        "id": f"cube-concept-3-1-p{pno:03}-q{num}",
                        "page": pno,
                        "genre": genre,
                        "unitHint": rec.get("unit"),
                        "number": num,
                        "content": body,
                        "flags": flags(body),
                    }
                )
        pages.append(rec)

    genre_count = Counter(p["genre"] for p in pages)
    item_genre = Counter(it["genre"] for it in items)
    flag_count = Counter(f for it in items for f in it["flags"])
    extract_pages = sum(
        1
        for p in pages
        if p["genre"] in {"개념한번더", "수학익힘", "서술형", "단원마무리", "평가"}
    )

    # 지면 가드 — p9 문항1 (331+247), p28 문항01 (264+123)
    p9 = next((it for it in items if it["id"].endswith("p009-q1")), None)
    p28 = next((it for it in items if it["id"].endswith("p028-q01")), None)
    guards = {
        "p9-q1-331": p9 is not None and "331" in (p9["content"] if p9 else ""),
        "p9-q1-247": p9 is not None and "247" in (p9["content"] if p9 else ""),
        "p28-q01-264": p28 is not None and "264" in (p28["content"] if p28 else ""),
        "p28-q01-123": p28 is not None and "123" in (p28["content"] if p28 else ""),
    }

    preview = []
    for key in ("p009-q1", "p009-q4", "p028-q01", "p028-q04", "p149-q01", "p149-q04"):
        it = next((x for x in items if x["id"].endswith(key)), None)
        if it:
            preview.append(
                f"{it['id']} [{it['genre']}] flags={it['flags']}\n{it['content'][:450]}\n"
            )

    usable = [
        it
        for it in items
        if "그리기" not in it["flags"] and "선잇기" not in it["flags"]
    ]
    text_only = [
        it for it in usable if "그림필요" not in it["flags"]
    ]

    summary = {
        "file": PDF.name,
        "pages": n,
        "genres": dict(genre_count),
        "extractPages": extract_pages,
        "items": len(items),
        "byGenre": dict(item_genre),
        "flags": dict(flag_count),
        "usableNoDraw": len(usable),
        "textOnly": len(text_only),
        "guards": guards,
        "leftoverControls": leftovers.most_common(15),
    }
    (OUT / "jindo31-items.json").write_text(
        json.dumps({"summary": summary, "pages": pages, "items": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "jindo31-preview.txt").write_text("\n---\n".join(preview), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("── preview ──")
    print("\n---\n".join(preview[:4]))
    hard = [k for k, v in guards.items() if not v and k.startswith("p28")]
    print("p9-odd-page-split", "FAIL" if not guards["p9-q1-331"] else "OK")
    if hard:
        print("GUARD_FAIL", hard)
        sys.exit(1)


if __name__ == "__main__":
    main()
