# -*- coding: utf-8 -*-
"""큐브수학 개념 진도북 8권 — 학기별 대단원·개념·지면 유형 카탈로그 (원장님 2026-08-23 지시).

「학기별 대단원 내부의 다양한 유형까지 숙지할 수 있게」— 책 자체의 체계를 그대로 뜬다:
  대단원(차례 쪽 범위) → 개념 목록(차례 ①~) → 쪽마다 어느 유형 지면인가
  (교과서 개념 잡기 / 개념 한 번 더 잡기 / 수학 익힘 문제 잡기 / 서술형 잡기 /
   단원 마무리 / 평가) → 문항 발문 표본.

⚠️ 차례의 «참»은 책의 차례 쪽이다 — 본문에서 역산하지 않는다(발문을 단원으로 오인한
  전례: learn-cube-units.py 의 units 목록). 검증은 렌더한 차례 쪽을 눈으로 대조한다.
공유 DB 금지 · 한컴 COM 금지 · N드라이브 읽기 전용.
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
OUT_DIR = Path("scripts/qa/reports/cube-catalog")

# 사설 글리프 — learn-cube-*.py 표 + 이번에 실물 대조로 넓힌 것.
# 0x99=²(5-1 차례 「1 cm²」) · 0x9A=³(6-1 「1 m³ 알아보기」) · 0x06=%(「백분율은 기호 %를」)
# · 0x1B=:(4-2 p125 시각 02:00~02:08 실물) · 0x81=℃(같은 쪽 세로축 「(℃)」)
# · 0x03/0x0F 는 보이지 않는 구획 표식 — 공백으로 (지우면 낱말이 붙는다).
EHSANG = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {
    **EHSANG,
    0x1E: "=", 0x1F: "<", 0x1D: ">", 0x0E: "-", 0x0C: "+", 0x40: "×", 0x96: "÷",
    0x99: "²", 0x9A: "³", 0x06: "%", 0x1B: ":", 0x81: "℃",
    0x03: " ", 0x0F: " ", 0x09: " ", 0x0A: " ", 0x0D: " ",
    # EHboNA(수식 조판 글꼴)의 분수 약물 «구조 표식» — 경계(0x1C)·분자/분모 구분(0x04·05·
    # 07·0B) 등. 분수 구조 복원은 이 카탈로그의 범위 밖이다(필요하면 RPM 도구가 이미 있다:
    # F:\시험지변환기 core). 지우기만 하므로 분수 낀 발문 표본은 숫자가 붙어 보인다 —
    # 유형 구조·차례·머리글(EHsang)에는 영향 없음.
    0x1C: "", 0x04: "", 0x05: "", 0x07: "", 0x0B: "", 0x10: "",
    0x7F: "", 0x8C: "", 0x8F: "",
}
# 표에 없는 제어·확장 코드포인트 발견기 — 새 판·새 책이 새 글리프를 들고 오면 여기 쌓인다.
# 0 이 아니면 그 글자는 날것으로 남아 있다(침묵 금지).
UNKNOWN_CODES: dict[int, int] = {}


def decode(s: str) -> str:
    out = []
    for c in s:
        o = ord(c)
        if o in GLYPH:
            out.append(GLYPH[o])
        else:
            if o < 0x20 or 0x7F <= o < 0xA0:
                UNKNOWN_CODES[o] = UNKNOWN_CODES.get(o, 0) + 1
            out.append(c)
    return "".join(out)


BOOKS = [(g, ROOT / "큐브수학 개념" / "진도북" / f"큐브수학 개념 {g}_진도북.pdf")
         for g in ("3-1", "3-2", "4-1", "4-2", "5-1", "5-2", "6-1", "6-2")]



# EHsang(사설 조판 글꼴) 안에서만 글자가 딴 뜻이다 — 3-2 p110·118 실물 대조로 푼 표:
#   D=c · N=m · L=k · H=g · U=t (단위 낱자, DN=cm · LH=kg · AU=" t")
#   A=공백(「HAHAH」=「g …g …g」) · ⇁·↻=□(빈칸 상자) · ASCII '-'=L(리터)
# ⚠️ 진짜 뺄셈 부호는 0x0E 코드포인트로 따로 온다(GLYPH 표) — 그래서 EHsang 치환을
# **먼저** 하고 일반 decode 를 나중에 한다. 순서를 뒤집으면 뺄셈이 리터가 된다.
# 글꼴 조건 없이 바꾸면 진짜 알파벳이 깨진다(STEP 의 N 등) — 글꼴이 가르는 것을
# 글자로 묻지 않는다(2026-08-19 RPM 교훈). 표에 없는 대문자 덩어리는 UNKNOWN_CAPS 로.
EHSANG_UNIT = {"D": "c", "N": "m", "L": "k", "H": "g", "U": "t"}
UNKNOWN_CAPS: dict[str, int] = {}


def decode_span(text: str, font: str) -> str:
    t = text
    if font.startswith("EHsang"):
        # ⓪ 공백(A)·빈칸 상자 먼저 — A 가 단위 토큰의 **경계**다. 뒤로 미루면
        #    「ADN」이 한 덩어리로 남아 토큰 매핑이 못 문다(실측: DN×67 미해독 잔상).
        t = t.replace("A", " ").replace("⇁", "□").replace("↻", "□")
        # ① 단위 토큰(알파벳에 안 붙은 D·N·L·H·U 덩어리)
        t = re.sub(
            r"(?<![A-Za-z])[DNLHU]{1,2}(?![A-Za-z])",
            lambda m: "".join(EHSANG_UNIT.get(c, c) for c in m.group(0)),
            t,
        )
        # ② ASCII 하이픈 = 리터 (뺄셈 부호는 0x0E 라 아직 하이픈이 아니다).
        #    「 m-」→「 mL」. ①보다 뒤여야 한다 — 앞이면 그 L 이 k 로 또 바뀐다.
        t = t.replace("-", "L")
        # ③ 전력량 kWh — 5-2 평균 단원의 전기 소재(실측 p93 「몇 LXI인가요」).
        t = t.replace("LXI", "kWh").replace("kXI", "kWh")
        for m in re.finditer(r"[A-Z]{2,}", t):
            UNKNOWN_CAPS[m.group(0)] = UNKNOWN_CAPS.get(m.group(0), 0) + 1
    return decode(t)


def spans_of(page: pymupdf.Page) -> list[dict]:
    out = []
    d = page.get_text("dict")
    for bl in d["blocks"]:
        for ln in bl.get("lines", []):
            for sp in ln.get("spans", []):
                t = decode_span(sp["text"], sp.get("font", "")).strip()
                if t:
                    out.append({
                        "t": t, "size": round(sp["size"], 1),
                        "x": round(sp["bbox"][0], 1), "y": round(sp["bbox"][1], 1),
                    })
    return out


def parse_toc(doc: pymupdf.Document) -> list[dict]:
    """차례 쪽에서 대단원·쪽범위·개념 목록을 뜬다.

    실측한 span 문법(3-1 p4): 쪽범위 「006~031」(18pt) 와 「쪽」이 딴 span,
    대단원 제목은 범위 **아래** 28pt, 개념 줄은 «숫자 span(10pt, 왼 열) + 제목 +
    수식 조각들»이 같은 y 줄에 흩어져 있어 y 로 재조합해야 한다.
    """
    units: list[dict] = []
    for pno in range(min(8, doc.page_count)):
        page = doc[pno]
        text = decode(page.get_text() or "")
        has_range = re.search(r"\d{3}\s*~\s*\d{3}", text)
        if "차례" not in text and not (units and has_range):
            continue
        sps = spans_of(page)
        page_units: list[dict] = []
        for sp in sps:
            m = re.fullmatch(r"(\d{3})\s*~\s*(\d{3})", sp["t"].replace(" ", ""))
            if not m or sp["size"] < 14:
                continue
            title = ""
            best_dy = 1e9
            for cand in sps:
                dy = cand["y"] - sp["y"]
                if cand["size"] >= 20 and 0 < dy < 60 and dy < best_dy:
                    best_dy, title = dy, cand["t"]
            if title:
                u = {
                    "unit": len(units) + 1,
                    "title": re.sub(r"\s+", " ", title),
                    "pageStart": int(m.group(1)),
                    "pageEnd": int(m.group(2)),
                    "concepts": [],
                    "tocPage": pno + 1,
                    "_titleY": sp["y"],
                }
                units.append(u)
                page_units.append(u)
        if not page_units:
            continue
        # 개념 줄: y 를 정렬해 3px 안이면 같은 줄로 걷는다 — 고정 버킷(y/4)은 경계에서
        # 줄을 가른다(실측: 「6. 1보다 작은 소수」의 6 과 1 이 딴 버킷에 떨어졌다).
        by_y = sorted(sps, key=lambda s: (s["y"], s["x"]))
        grouped: list[list[dict]] = []
        for sp in by_y:
            if grouped and abs(sp["y"] - grouped[-1][0]["y"]) <= 3:
                grouped[-1].append(sp)
            else:
                grouped.append([sp])
        for line in grouped:
            line.sort(key=lambda s: s["x"])
            head = line[0]
            if not re.fullmatch(r"\d{1,2}", head["t"]):
                continue
            if head["size"] > 12 or len(line) < 2:
                continue
            # span 은 글꼴이 갈리는 자리(연산자·수식)에서만 쪼개지고 낱말 안 공백은
            # span 안에 살아 있다 — 그냥 x 순으로 이어붙이면 원문이 된다.
            body = "".join(s["t"] for s in line[1:] if s["size"] <= 13).strip()
            body = re.sub(r"\s+", " ", body)
            # 「각」 같은 한 글자 개념이 있다 — 길이로 거르지 않는다. 쪽 번호 줄만 뺀다.
            if not body or "쪽" in body or re.fullmatch(r"[\d~ ]+", body):
                continue
            best = None
            best_dy = 1e9
            for u in page_units:
                dy = head["y"] - u["_titleY"]
                if dy > 0 and dy < best_dy:
                    best, best_dy = u, dy
            if best is not None:
                item = f"{head['t']}. {body}"
                if item not in best["concepts"]:
                    best["concepts"].append(item)
    for u in units:
        u.pop("_titleY", None)
    return units


BADGES = ["교과서 공통", "익힘책 공통", "서술형", "창의", "문제 해결"]


def section_start(sps: list[dict]) -> str | None:
    """이 쪽이 **구획 머리글**로 시작하는가. 아니면 None — 앞 구획이 이어진다.

    본문 문구로 갈면 오탐이 난다 — 연습 쪽의 「~에서 개념을 한 번 더 다집니다」가
    「개념 한 번 더 잡기」로 잡혔다(실측). 머리글은 ≥17pt 라 본문(≤13pt)과 갈리고,
    「문 제 잡기」처럼 낱말 안에 공백이 있어 **공백을 지우고** 대조한다(실측 p24).
    """
    big = sorted((s for s in sps if s["size"] >= 17), key=lambda s: (s["y"], s["x"]))
    header = re.sub(r"\s+", "", "".join(s["t"] for s in big[:8]))
    if re.search(r"개념한번더잡기|한번더잡기", header):
        return "개념 한 번 더 잡기"
    if "개념잡기" in header:
        return "교과서 개념 잡기"
    if "익힘문제잡기" in header or "익힘문제" in header:
        return "수학 익힘 문제 잡기"
    if "서술형잡기" in header:
        return "서술형 잡기"
    if "단원마무리" in header:
        return "단원 마무리"
    if re.search(r"총정리|평가", header):
        return "평가"
    if any(s["size"] >= 40 and re.search(r"[가-힣]", s["t"]) for s in sps):
        return "단원 도입"
    return None


def page_stems(sps: list[dict], compact: str) -> list[str]:
    """문항 발문 표본 — 발문 동사로 끝나는 짧은 조각을 최대 6개."""
    stems = []
    for m in re.finditer(
        r"[가-힣0-9①-⑮⑴-⒂()\[\]{}+\-×÷=<>.,?%\s]{6,90}?"
        r"(쓰세요|써넣으세요|구하세요|고르세요|그리세요|색칠하세요|표시하세요|비교하세요|"
        r"찾아보세요|말해 보세요|알아보세요|나타내세요|계산하세요|풀어 보세요|만들어 보세요|"
        r"이어 보세요|묶어 보세요|확인하세요)",
        compact,
    ):
        s = re.sub(r"\s+", " ", m.group(0)).strip()
        s = re.sub(r"^[\d\s.①-⑮⑴-⒂]+", "", s)
        if len(s) >= 8 and s not in stems:
            stems.append(s)
        if len(stems) >= 6:
            break
    return stems


def build_book(grade: str, path: Path) -> dict:
    doc = pymupdf.open(path)
    toc = parse_toc(doc)
    pages = []
    current = "앞부속"
    for pno in range(doc.page_count):
        page = doc[pno]
        sps = spans_of(page)
        compact = re.sub(r"\s+", " ", " ".join(s["t"] for s in sorted(sps, key=lambda s: (s["y"], s["x"]))))
        start = section_start(sps)
        # 구획은 머리글에서 시작해 다음 머리글까지 **이어진다** — 익힘·마무리 뒤 쪽에는
        # 머리글이 없다(실측 p25·26·30). 쪽 단위로 갈면 그 쪽들이 「기타」로 뭉개진다.
        if start is not None:
            current = start
        elif current == "단원 도입":
            current = "단원 구성 안내"
        # 「서술형 잡기」 머리글은 벡터 그림이라 텍스트에 없다(실측 p27 렌더).
        # 이 지면에만 있는 「해결 순서」 발판(문항마다 붙는다)을 열쇠로 쓴다 —
        # 전 쪽 실측: 27·49·67·89·113·143(단원당 1) + p3(구성 안내, 앞부속이라 안 걸림).
        # 배지가 「해결/순서」 **두 줄 세로 쌓임**이라 이어붙인 문자열에서는 사이에 딴
        # span 이 끼어 못 센다(실측 p67). 낱개 span(정확히 그 두 글자)의 짝 수로 센다 —
        # 본문의 「뺄셈으로 해결하기」는 긴 span 이라 안 걸린다.
        badge_pairs = min(
            sum(1 for s in sps if s["t"] == "해결"),
            sum(1 for s in sps if s["t"] == "순서"),
        )
        if badge_pairs >= 2 and current != "앞부속":
            current = "서술형 잡기"
        kind = current
        big = [s["t"] for s in sps if s["size"] >= 30][:3]
        badges = [b for b in BADGES if b in compact]
        pages.append({
            "page": pno + 1,
            "kind": kind,
            "badges": badges,
            "bigSpans": big,
            "stems": page_stems(sps, compact),
        })
    doc.close()
    # 대단원에 쪽 배정 (차례 쪽 범위 기준)
    for u in toc:
        u["pages"] = [p for p in pages if u["pageStart"] <= p["page"] <= u["pageEnd"]]
    tail = [p for p in pages if not any(u["pageStart"] <= p["page"] <= u["pageEnd"] for u in toc)]
    return {"grade": grade, "file": path.name, "pageCount": len(pages),
            "units": toc, "unassignedPages": [p["page"] for p in tail if p["kind"] != "연습·기타"]}


DOC_PATH = Path("docs/planning/tracks/cube-concept-catalog.md")

DOC_HEAD = """# 큐브수학 개념 진도북 8권 — 대단원·개념·지면 유형 카탈로그

> **생성 문서.** 손으로 고치지 말 것 — `python scripts/qa/build-cube-type-catalog.py` 가
> N드라이브 원본에서 다시 만든다. 쪽별 발문 표본까지는
> `scripts/qa/reports/cube-catalog/concept-*.json` 에 있다.
> 원장님 지시(2026-08-23): 「큐브수학 개념 내용 완전히 분석해서 학기별 대단원 내부의
> 다양한 유형까지 숙지할 수 있게」.

## 1. 시리즈 공통 지면 문법 — 유형은 **구획**이 나른다

8권 전부 한 대단원이 같은 사다리로 돈다 (152쪽 판형 공통):

| 구획 | 내용 | 우리 4단(D-71) 대응 |
|---|---|---|
| 단원 도입 | 만화 한 쪽 | — |
| 단원 구성 안내 | 구획 목록·쪽수 | — |
| 교과서 개념 잡기 | 펼침면: 왼쪽 개념 설명+STEP 확인(빈칸 따라하기), 오른쪽 연습(**교과서 공통** 배지, 매칭북 더-연습 링크) | 연산~기본 |
| 개념 한 번 더 잡기 | **개념 3개마다** 끼는 반복 연습 펼침면 (계산 드릴) | 연산 |
| 수학 익힘 문제 잡기 | **익힘책 공통** 배지 문항 3~4쪽 — 문장제 한 겹 | 기본~응용 |
| 서술형 잡기 | 단원당 1쪽. **해결 순서** 발판 스캐폴드. 잘못 찾아 고치기·수 카드 역산 등 | 응용~심화 |
| 단원 마무리 | 종합 4쪽 — 끝에 서술형 탭·**창의** 문제 | 기본~심화 혼합 |
| (권말) 학업 성취도 평가 | 149~152쪽 학기 총정리 | — |

- 난이도 사다리는 **개념 → 교과서 공통 → 익힘책 공통 → 서술형·창의** 차례다. 교재
  사다리 전체에서 이 책은 개념~기본 층이고, 그 위가 개념응용·실력·최상위다
  (`elem-difficulty-textbook-survey-20260823.md`).
- 유형을 문항 하나하나가 아니라 **구획+배지+개념 소속**이 정한다 — 그래서 이 카탈로그의
  단위는 「대단원 → 개념 목록 → 구획 쪽 지도」다. 쪽별 발문 표본은 JSON 에 있다.

## 2. 글리프 복호표 (다음 사람이 같은 함정을 밟지 않게)

PDF 텍스트 레이어는 사설 조판 글꼴이라 글자가 딴 뜻이다. **글꼴이 가르므로 글꼴
조건부로만** 바꾼다 (2026-08-19 RPM 교훈 그대로):

- **EHsang** 안: `D`=c · `N`=m · `L`=k · `H`=g · `U`=t (DN=cm·LH=kg·NL 없음),
  `A`=공백, ASCII `-`=**리터 L**(진짜 뺄셈은 0x0E), `⇁`·`↻`=□, `LXI`=kWh
- 코드포인트: 0x11~0x1A=0~9 · 0x1B=`:` · 0x99=² · 0x9A=³ · 0x06=% · 0x81=℃
- **EHboNA**(수식 조판)의 분수 약물 표식(0x1C·04·05·07·0B)은 **복원하지 않는다** —
  분수 낀 발문 표본은 숫자가 붙어 보인다. 구조·차례·머리글에는 영향 없음.
  필요해지면 RPM 도구(F:\\시험지변환기 core)가 그 글꼴을 이미 안다.
- 스크립트에 **발견기**가 있다: 표에 없는 대문자 덩어리·코드포인트가 나오면 실행 끝에
  ⚠️ 로 찍힌다. 0 이 아니면 그 글자는 날것으로 남아 있다는 뜻이다.

## 3. 학기별 대단원 · 개념 전량 (차례 쪽에서 추출, 3-1·5-1 차례 렌더로 눈 대조)

"""

DOC_TAIL = """
## 4. 엔진 확대에 쓰는 법

1. 소단원을 확대할 때 이 카탈로그에서 해당 학기·대단원의 **개념 목록**을 먼저 보고,
   우리 230 소단원의 갈래가 그 개념들을 빠짐없이 덮는지 센다.
2. 유형 감이 필요하면 JSON 의 그 대단원 쪽 지도에서 구획별 쪽 번호를 얻어 **그 쪽을
   렌더해서 본다** (발문 표본은 두 단 조판이 섞인 조각이라 방향타일 뿐이다).
3. 난이도 위층(응용~심화)은 같은 폴더의 개념응용·실력 진도북, 최상위수학 5-1 에서
   같은 단원을 찾아 렌더한다 — 절차는 `elem-difficulty-textbook-survey-20260823.md` §4.

## 5. 한계 (읽는 사람이 알아야 할 것)

- 발문 표본(stems)은 두 단 조판을 한 줄로 편 것이라 **조각**이다 — 유형 이름이 아니라
  단서로 쓸 것. 정확한 지면은 쪽 번호로 렌더해 본다.
- 대단원 쪽 범위 밖(표지·차례·권말 평가 149~152쪽)은 단원에 배정하지 않았다.
- 매칭북·개념응용·실력 시리즈는 이 카탈로그에 없다 — 다음 채집 대상이다.
"""


def render_md(books: list[dict]) -> str:
    parts = [DOC_HEAD]
    for book in books:
        n_concepts = sum(len(u["concepts"]) for u in book["units"])
        parts.append(f"### {book['grade']} ({book['file']} · {book['pageCount']}쪽 · 개념 {n_concepts})\n")
        for u in book["units"]:
            kinds: dict[str, int] = {}
            for p in u["pages"]:
                kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
            kind_s = " · ".join(f"{k} {v}쪽" for k, v in kinds.items() if k not in ("단원 도입", "단원 구성 안내"))
            parts.append(f"**{u['unit']}. {u['title']}** (p{u['pageStart']}~{u['pageEnd']}) — {kind_s}\n")
            for c in u["concepts"]:
                parts.append(f"- {c}")
            parts.append("")
    parts.append(DOC_TAIL)
    return "\n".join(parts)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    books: list[dict] = []
    for grade, path in BOOKS:
        if only and grade != only:
            continue
        if not path.exists():
            print(f"❌ 없음: {path}")
            continue
        book = build_book(grade, path)
        books.append(book)
        out = OUT_DIR / f"concept-{grade}.json"
        out.write_text(json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8")
        n_concepts = sum(len(u["concepts"]) for u in book["units"])
        print(f"✅ {grade}: 대단원 {len(book['units'])} · 개념 {n_concepts} · {book['pageCount']}쪽 → {out}")
        for u in book["units"]:
            kinds = {}
            for p in u["pages"]:
                kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
            print(f"   {u['unit']}. {u['title']} (p{u['pageStart']}~{u['pageEnd']}) 개념 {len(u['concepts'])} — "
                  + " · ".join(f"{k}{v}" for k, v in kinds.items()))
    # 문서는 **8권 전부**를 돌렸을 때만 쓴다 — 부분 실행이 덮어쓰면 나머지 학기가
    # 문서에서 사라진다 (2026-08-20 「되돌리기 원장을 덮어쓰면」과 같은 자리).
    if len(books) == len(BOOKS):
        DOC_PATH.parent.mkdir(parents=True, exist_ok=True)
        DOC_PATH.write_text(render_md(books), encoding="utf-8")
        print(f"📄 카탈로그 문서 → {DOC_PATH}")
    elif only:
        print(f"(부분 실행 — {DOC_PATH} 는 갱신하지 않음)")
    if UNKNOWN_CAPS:
        # EHsang 안에서 표에 없는 대문자 덩어리 — 다른 학기의 들이·무게 단위(L·kg)일 수
        # 있다. 0 이 아니면 표를 넓히기 전까지 그 글자는 날것으로 남는다(침묵 금지).
        top = sorted(UNKNOWN_CAPS.items(), key=lambda kv: -kv[1])[:12]
        print("⚠️ EHsang 미해독 대문자: " + " ".join(f"{k}×{v}" for k, v in top))
    if UNKNOWN_CODES:
        top = sorted(UNKNOWN_CODES.items(), key=lambda kv: -kv[1])[:12]
        print("⚠️ 미해독 코드포인트: " + " ".join(f"0x{k:02X}×{v}" for k, v in top))


if __name__ == "__main__":
    main()
