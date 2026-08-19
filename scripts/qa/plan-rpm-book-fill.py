# -*- coding: utf-8 -*-
"""**비어 있는** RPM 해설·정답을 정답책에서 채울 계획을 만든다.

    python scripts/qa/plan-rpm-book-fill.py            # 집계
    python scripts/qa/plan-rpm-book-fill.py --list 10  # 표본
    python scripts/qa/plan-rpm-book-fill.py --emit     # 계획 파일로

입력: `scripts/qa/reports/rpm-empty-slots.json` (비어 있는 자리 — DB 에서 뽑는다)
      `.rpm-src/RPM 중학 N-M 정답.pdf`
출력: `scripts/qa/reports/rpm-book-fill.json`

## **비어 있는 자리만** 손댄다

이미 들어 있는 값은 건드리지 않는다. 우리 것은 쌓인 분수가 살아 있고 원문은 납작하다
— 원문이 늘 더 낫지 않다(`score-rpm-latex.py` 머리말). 그러니 이 도구는 «없는 자리»만
채운다. `\\square` 로 무너진 자리는 나란히 보고 사람이 정한다(별도 대조표).

## 실측 결론 (2026-08-19) — **넣을 만한 것이 없었다**

비어 있는 자리 326(해설 255 · 정답 71)에 이 계획을 돌리면 24건이 남는데,
**전량 눈으로 보니 하나도 못 넣겠다.**

· 쌓인 분수가 납작해진다 — `4-√2 = 14 14 5(√10-3) 5`. 분수선이 그림이라
  PDF 텍스트 레이어에 안 남는다. 수식 위주 해설은 이 한 가지로 전부 무너진다.
· 나머지는 「전략 …」 한 줄이거나 문장 조각이다.

정답 71건은 **책에서 `답` 줄 자체가 안 잡힌다**(풀이는 있는데). 그 51건은 원본 구조가
달라 따로 조사해야 한다 — 표본을 보면 답이 `답` 줄이 아니라 풀이 본문에 섞여 있다.

그래서 **아무것도 안 넣었다.** 도구는 남긴다 — 분수 복원이 되면 그때 다시 돌린다.

## 채우지 않는 조건 — 애매하면 안 넣는다

· 변환 뒤에도 원문 전용 글자가 남으면 (화면에서 깨진다)
· 뽑아낸 것이 **답을 되풀이한 것**이면 (표·그래프 축 라벨이 그렇다)
· 쪽 장식이면 (`book_solution_map` 이 이미 걸러 내지만 한 번 더 본다)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = pathlib.Path(__file__).parent
EMPTY = pathlib.Path("scripts/qa/reports/rpm-empty-slots.json")
ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-book-fill.json")
SRC = pathlib.Path(".rpm-src")
KEEP = re.compile(r"[가-힣0-9]+")
#: 변환 뒤 남은 «원문 전용» 글자. 하나라도 남으면 화면에서 깨지므로 안 넣는다.
RESIDUE = re.compile(r"[^\x20-\x7e가-힣\s∠△∽≤≥≠±×÷√…∴°⑴-⑿①-⑳㉠-㉪㈀-㈜ㄱ-ㅎ→∼≡∥⊥¨]")
#: 뽑아낸 것이 답과 이만큼 닮으면 «되풀이»다 — 새 정보가 없다.
ECHO_SIM = 0.6
#: 풀이라면 **한글**이 있거나 **관계식**이 있어야 한다.
#: ⚠️ 이게 없으면 좌표평면의 **축 라벨**이 풀이로 잡힌다 — 실측 `4 2 2 4`.
#:    답이 그래프인 문항은 책이 그림만 싣고 풀이를 안 쓴다. 답 되풀이 검사로는 못 잡는다
#:    (우리 답은 LaTeX 서술이고 축 라벨은 맨 숫자라 안 닮는다).
MEANINGFUL = re.compile(r"[가-힣]{2,}|[=<>≤≥]")


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def key(t: str) -> str:
    return "".join(KEEP.findall(t))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", type=int, default=0)
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()

    auditsol = load("auditsol", "audit-rpm-solutions.py")
    rpmlatex = load("rpmlatex", "rpm_book_latex.py")

    slots = json.loads(EMPTY.read_text(encoding="utf-8"))["목록"]
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId")
    }

    books: dict[str, dict[int, tuple[str, str]]] = {}
    plan: list[dict] = []
    tally: dict[str, int] = {}
    shown = 0

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    for s in slots:
        o = origin.get(s["id"])
        if not o or not o.get("book") or not o.get("printedNumber"):
            bump("출처가 없다")
            continue
        book = o["book"]
        pdf = SRC / book.replace("학생용", "정답")
        if not pdf.exists():
            bump("정답책이 없다")
            continue
        if book not in books:
            books[book] = auditsol.book_solution_map(pdf)
            print(f"  {book} 색인 {len(books[book])}", flush=True)
        q = int(re.sub(r"\D", "", o["printedNumber"]) or 0)
        got = books[book].get(q)
        if not got:
            bump("정답책에 그 번호가 없다")
            continue
        body, ans = got

        raw = body if s["field"] == "solution" else auditsol.ANSWER_PREFIX.sub("", ans)
        if not raw.strip():
            bump(f"원본에도 {'해설' if s['field'] == 'solution' else '정답'}이 없다")
            continue
        value = rpmlatex.to_latex(raw)
        if not MEANINGFUL.search(value):
            bump("풀이가 아니라 그림 라벨이다 (한글도 관계식도 없다)")
            continue
        left = RESIDUE.findall(value)
        if left:
            bump("변환 뒤에도 원문 글자가 남는다")
            continue
        # 되풀이 검사는 «지금 우리가 가진 값»과 견준다. 정답을 채울 때는 본문과 견준다.
        against = key(s.get("answer") or "") if s["field"] == "solution" else key(s.get("content") or "")
        kb = key(value)
        if kb and against and (kb in against or SequenceMatcher(None, kb, against).ratio() >= ECHO_SIM):
            bump("이미 가진 값을 되풀이한 것")
            continue
        plan.append({"id": s["id"], "field": s["field"], "book": book, "q": q, "value": value})
        if a.list and shown < a.list:
            shown += 1
            print(f"\n--- {book[7:10]} #{q} [{s['field']}]\n  {value[:170]}")

    print(f"\n비어 있는 자리 {len(slots)} · 채울 것 {len(plan)}")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  건너뜀: {k} {v}")
    byf: dict[str, int] = {}
    for p in plan:
        byf[p["field"]] = byf.get(p["field"], 0) + 1
    print(f"  갈래별: {byf}")

    if a.emit:
        OUT.write_text(json.dumps({"집계": tally, "목록": plan}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"→ {OUT}")


if __name__ == "__main__":
    main()
