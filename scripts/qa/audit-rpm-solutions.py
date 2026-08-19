# -*- coding: utf-8 -*-
"""RPM 해설이 **원본에도 없는가**를 정답책에서 확인한다. 토큰 0 · API 0.

    python scripts/qa/audit-rpm-solutions.py            # 집계
    python scripts/qa/audit-rpm-solutions.py --list     # 행별
    python scripts/qa/audit-rpm-solutions.py --emit     # 채울 것만 계획으로

입력: `scripts/qa/reports/rpm-missing-solution.json` (해설 없는 우리 행)
      `.rpm-src/RPM 중학 N-M 정답.pdf`                (정답·해설 정본)
출력: `scripts/qa/reports/rpm-solution-audit.json`

## 「없다」와 「못 찾았다」는 다른 말이다

해설이 빈 255행을 그냥 채우려 들면 안 된다. **원본에도 없는 것이 있다** —
개념 확인 문제는 책이 `답 ∠h` 한 줄만 찍고 풀이를 안 싣는다(실측 `0162`).
그걸 억지로 채우면 없는 풀이를 지어내게 된다.

그래서 원본을 열어 **문항 번호를 앵커로** 잡고 그 다음 앵커까지를 읽는다.
`답 …` 줄을 걷어낸 나머지가 비면 **원본에도 없는 것**이고, 남으면 **우리가 놓친 것**이다.
둘을 숫자로 갈라 놓아야 「채울 수 있는 것」이 몇 건인지 말할 수 있다.

## 실측 결론 (2026-08-19) — **채울 수 있는 것이 사실상 없다**

해설이 빈 255행을 이 도구로 갈랐다:

| | |
|---|---:|
| 원본에도 해설이 없다 | **201** |
| 풀이가 아니라 답을 되풀이한 것 | 12 |
| 책·번호가 없어 역추적 불가 | 14 |
| 원본에 해설이 있다 | 28 |

그 28건도 **그대로는 못 넣는다.** 21건이 교재 PDF 의 **사유 글꼴 인코딩**이다 —
`'3`=√3 · `Û`=² · `Ó`=위선 · `;5@;`=분수 · `ù`=°. 그대로 저장하면 화면에 깨져 나가고,
기존 4,607건은 전부 제대로 된 LaTeX 다. 나머지 7건 중 4건은 쪽 부스러기·답 되풀이·
엉뚱한 문항이고 3건은 「전략 …」 한 줄뿐이다.

**그래서 아무것도 안 넣었다.** 넣으려면 그 글꼴 매핑을 LaTeX 로 옮기는 변환기가 먼저다
(HWP 수식 스크립트 변환기와 성격은 같지만 매핑표가 다르다).

덤으로 드러난 것: 정답 칸에 **문자열 「(정답 없음)」이 든 행이 71개**다. 빈 값이 아니라
자리 표시자라 `count(answer)` 로는 안 보인다 — 정답 실적은 100% 가 아니라 98.5% 다.

## 정렬이 맞는지 **본문 밖에서** 검산한다

번호로 찾는 것만으로는 「그 문항이 맞나」를 모른다. 그래서 원본이 찍은 `답 …` 을
우리 DB `answer` 와 대 본다 — 출처가 다른 두 값이라 어긋나면 정렬이 틀린 것이다.
(CLAUDE.md 2026-08-17 「본문과 독립인 근거를 하나 더 요구하라」)
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

MISSING = pathlib.Path("scripts/qa/reports/rpm-missing-solution.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-solution-audit.json")
SRC = pathlib.Path(".rpm-src")
ANSWER_LINE = re.compile(r"^\s*답\s")
#: 책이 찍는 `답` 접두어. 검산할 때 떼지 않으면 우리 답과 언제나 어긋난다(내 버그였다).
ANSWER_PREFIX = re.compile(r"^\s*답\s*")
KEEP = re.compile(r"[가-힣0-9]+")
#: 앵커로 인정하는 문항 번호 모양. 교재는 네 자리로 찍는다(`0162`).
ANCHOR = re.compile(r"^\d{4}$")
#: 이만큼 넘게 남으면 «풀이가 있다»고 본다. `답` 줄을 걷어낸 뒤 남는 부스러기를 무시한다.
BODY_MIN = 4
#: 풀이로 인정하려면 **한글이 이만큼** 있거나 등호가 있어야 한다.
#: ⚠️ 이게 없으면 «그래프 축 라벨»이 풀이로 잡힌다 — 실측 `y 4 2 x -4 -2 2 4 O -2 -4`.
#: 답이 그래프인 문항은 책이 좌표평면 그림만 싣고 풀이를 안 쓴다.
BODY_KO_MIN = 2
#: 같은 줄이 **이만큼 많은 쪽**에 나오면 쪽 장식이다(머리말·꼬리말·판형 번호).
#: ⚠️ 낱말 목록으로 지우면 그 목록에 없는 서식은 구조적으로 못 본다. 실측으로
#:    「50 정답 및 풀이 191226」·「본문 104 ~ 111 쪽」·「08 이차함수의 그래프 ⑴67」이
#:    풀이로 잡혔는데, 셋 다 **여러 쪽에 되풀이된다**. 그게 가르는 성질이다.
FURNITURE_MIN_PAGES = 3
#: 되풀이를 셀 때 숫자는 지운다 — 쪽번호·판형번호만 다른 같은 줄이기 때문이다.
DIGITS = re.compile(r"\d+")
#: 우리 DB 가 정답 자리에 넣어 둔 자리 표시자. 값이 아니라 «모른다»는 뜻이다.
PLACEHOLDER = re.compile(r"^\(?\s*(정답|답)\s*없음\s*\)?$")
#: 뽑아낸 「풀이」가 실은 **답을 되풀이한 것**이면 채우지 않는다.
#: 실측 두 부류: ⑴ 도수분포표·그래프 축 라벨 — 답 그 자체다.
#:               ⑵ 「축의 방정식 : x=0」 — 답의 **조각**이다(답이 두 줄로 쪼개져 찍힌다).
#: 가르는 성질은 «답 안에 들어 있나»다. 들어 있으면 새 정보가 없다.
ANSWER_ECHO_SIM = 0.6


def key(text: str) -> str:
    return "".join(KEEP.findall(text))


def book_solution_map(pdf: pathlib.Path) -> dict[int, tuple[str, str]]:
    """정답책 전체를 훑어 {문항번호: (풀이, 답)} 을 만든다.

    앵커는 **줄 첫머리에 홀로 선 네 자리 수**다. 단이 둘이므로 좌표로 단을 가른 뒤
    각 단 안에서 읽는 순서대로 이어 붙인다 — 그래야 다음 앵커까지가 그 문항 몫이 된다.
    """
    doc = pymupdf.open(pdf)

    # ── 쪽 장식을 먼저 찾는다 — 여러 쪽에 되풀이되는 줄 ─────────────────
    # ⚠️ **앵커를 장식으로 잡으면 안 된다.** 숫자를 지우는 규칙이라 `0162` 는 빈 문자열이
    #    되고, 빈 문자열은 모든 쪽에 있다 — 처음에 이 가드가 거꾸로 걸려 앵커가 통째로
    #    사라졌다(「번호가 없다」 228건). 그래서 앵커로 시작하는 줄과 빈 열쇠는 뺀다.
    seen: dict[str, set[int]] = {}
    for pi in range(doc.page_count):
        for ln in doc[pi].get_text("text").splitlines():
            t = ln.strip()
            if not t or ANCHOR.fullmatch(t.split(" ")[0]):
                continue
            k = DIGITS.sub("", t).strip()
            if k:
                seen.setdefault(k, set()).add(pi)
    furniture = {k for k, ps in seen.items() if len(ps) >= FURNITURE_MIN_PAGES}

    out: dict[int, tuple[str, str]] = {}
    for pi in range(doc.page_count):
        page = doc[pi]
        mid = page.rect.width / 2
        # (단, y, x, 글자) 로 정렬해 읽는 순서를 만든다.
        rows: list[tuple[int, float, float, str, bool]] = []
        for b in page.get_text("dict").get("blocks", []):
            for ln in b.get("lines", []):
                txt = "".join(sp.get("text", "") for sp in ln.get("spans", []))
                if not txt.strip():
                    continue
                if not ANCHOR.fullmatch(txt.strip().split(" ")[0]) and DIGITS.sub(
                    "", txt.strip()
                ).strip() in furniture:
                    continue  # 쪽 장식 — 풀이가 아니다
                x0, y0 = ln["bbox"][0], ln["bbox"][1]
                first = txt.strip().split(" ")[0]
                rows.append((0 if x0 < mid else 1, y0, x0, txt, bool(ANCHOR.fullmatch(first))))
        rows.sort(key=lambda r: (r[0], r[1], r[2]))

        cur: int | None = None
        buf: list[str] = []

        def flush(n: int | None, lines: list[str]) -> None:
            if n is None:
                return
            body = [ln for ln in lines if not ANSWER_LINE.match(ln)]
            ans = [ln for ln in lines if ANSWER_LINE.match(ln)]
            prev = out.get(n)
            b = " ".join(x.strip() for x in body).strip()
            a = " ".join(x.strip() for x in ans).strip()
            if prev:  # 같은 번호가 두 번 나오면 **긴 쪽**을 남긴다(쪽 넘김 등).
                b = b if len(b) >= len(prev[0]) else prev[0]
                a = a or prev[1]
            out[n] = (b, a)

        for _col, _y, _x, txt, is_anchor in rows:
            if is_anchor:
                flush(cur, buf)
                head = txt.strip()
                cur = int(head[:4])
                rest = head[4:].strip()
                buf = [rest] if rest else []
            elif cur is not None:
                buf.append(txt)
        flush(cur, buf)
    doc.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()

    rows = json.loads(MISSING.read_text(encoding="utf-8"))["목록"]
    books: dict[str, dict[int, tuple[str, str]]] = {}
    tally: dict[str, int] = {}
    fill: list[dict] = []

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    for r in rows:
        book = r.get("book")
        q = r.get("q")
        if not book or not q:
            bump("책·번호가 없다 (역추적 불가)")
            continue
        sol_pdf = SRC / book.replace("학생용", "정답")
        if not sol_pdf.exists():
            bump("정답책이 없다")
            continue
        if book not in books:
            books[book] = book_solution_map(sol_pdf)
            print(f"  {book} → 문항 {len(books[book])}개 색인", flush=True)
        got = books[book].get(int(q))
        if got is None:
            bump("정답책에 그 번호가 없다")
            continue
        body, ans = got
        # 정렬 검산 — 원본이 찍은 답과 우리 답이 닮았나.
        sim = SequenceMatcher(
            None, key(ANSWER_PREFIX.sub("", ans)), key(r.get("answer") or "")
        ).ratio()
        ko = sum(1 for ch in body if "가" <= ch <= "힣")
        if len(key(body)) < BODY_MIN or (ko < BODY_KO_MIN and "=" not in body):
            bump("원본에도 해설이 없다")
            if a.list:
                print(f"  없음 {book} #{q}  답={ans[:30]} (우리 답 닮음 {sim:.2f})")
            continue
        ours = key(r.get("answer") or "")
        bk = key(body)
        echo = bool(bk) and (bk in ours or SequenceMatcher(None, bk, ours).ratio() >= ANSWER_ECHO_SIM)
        if echo:
            bump("풀이가 아니라 답을 되풀이한 것")
            if a.list:
                print(f"  되풀이 {book} #{q}  {body[:60]}")
            continue
        bump("원본에 해설이 있다 — 우리가 놓쳤다")
        fill.append({"id": r["id"], "book": book, "q": q, "solution": body,
                     "bookAnswer": ans, "ourAnswer": r.get("answer"), "answerSim": round(sim, 3)})
        if a.list:
            print(f"  있음 {book} #{q} (답 닮음 {sim:.2f}) {body[:70]}")

    print(f"\n해설 없는 {len(rows)}행")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {str(v).rjust(4)}  {k}")

    if fill:
        sims = sorted(f["answerSim"] for f in fill)
        print(f"\n채울 수 있는 {len(fill)}행 · 답 닮음 최저 {sims[0]} 중앙 {sims[len(sims)//2]}")
    if a.emit:
        OUT.write_text(json.dumps({"집계": tally, "채울것": fill}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"→ {OUT}")


if __name__ == "__main__":
    main()
