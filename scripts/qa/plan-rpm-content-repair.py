# -*- coding: utf-8 -*-
"""깨진 RPM **발문**을 학생용 책의 그 칸에서 되살릴 계획을 만든다.

    python scripts/qa/plan-rpm-content-repair.py            # 집계
    python scripts/qa/plan-rpm-content-repair.py --list 6   # 표본을 나란히
    python scripts/qa/plan-rpm-content-repair.py --emit     # 계획 파일로

입력: `scripts/qa/reports/rpm-damage-census.json` (무엇이 깨졌나 — 갈래별)
      `scripts/qa/reports/rpm-origin.json`        (책·쪽·칸 좌표)
출력: `scripts/qa/reports/rpm-content-repair.json`

## 발문의 진짜 결함은 □ 가 아니라 **흩어진 근호**다

`\\square ABCD` 는 사각형 ABCD 다 — 정상 표기다. 발문의 □ 233행 중 **164행이 이것**
이라 「□ 233행이 깨졌다」는 그냥 틀린 숫자다. 반대로 □ 가 하나도 없이 깨진 것이 있다:
`③ $20$ $3cm^{2}$` — 원래 $20\\sqrt3\\,cm^2$ 인데 근호가 `\\surd` 로 떨어져 나가
**보기가 통째로 다른 수**가 됐다. 234행 786자리다(`census-rpm-damage.ts`).

## 칸 좌표가 있다 — 그 자리를 그대로 다시 읽는다

`rect` 는 학생용 책에서 그 문항이 차지한 상자다. 거기를 `rpm_page_text` 로 읽으면
분수·근호가 되살아난 채로 나온다.

**두 가지를 빼야 한다.**
 · **그림 라벨** — 그림 상자(가로선이 아닌 획들의 테두리) 안의 글자. 본문과 같은
   높이에 있어서 줄을 묶은 뒤에 빼면 이미 붙어 있다.
 · **옆단 세로 글자** — 쪽 가장자리에 세로로 찍힌 단원 이름(`정 수 와 유 리 수`).
   한 글자짜리가 같은 x 에 줄지어 선다.

## 「같은 문항인가」는 **번호로** 묻는다

`verify-rpm-number.py` 가 학생용 책에서 그 번호가 찍힌 쪽을 찾아 확인한다.
여기서는 그 위에 한 가지 더 본다 — 되살린 글의 한글이 지금 값의 한글과 닮아야 한다.
지금 값은 수식이 깨졌어도 **한글은 살아 있다**.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import rpm_guards  # noqa: E402  — 두 계획이 **같은 가드**를 쓴다
sys.path.insert(0, str(HERE))
import rpm_page_text as rpt  # noqa: E402

CENSUS = pathlib.Path("scripts/qa/reports/rpm-damage-census.json")
ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
NUMCHK = pathlib.Path("scripts/qa/reports/rpm-number-check.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-content-repair.json")
SRC = pathlib.Path(".rpm-src")
KO = re.compile(r"[가-힣]+")
CHOICE = re.compile(r"([①-⑮])")
#: 지금 값과 한글이 이만큼은 닮아야 같은 문항으로 본다.
MIN_KO_SIM = 0.6
MIN_KO_LEN = 6
#: 옆단 세로 글자 — 한 글자짜리가 같은 x 에 이만큼 줄지어 서면 단원 이름 띠다.
TAB_MIN = 3
TAB_X_TOL = 3.0
#: 변환 뒤에도 남으면 화면에서 깨지는 글자. `¨` 는 뺐다 — 호(弧)는 이제 `\overgroup`
#: 으로 나가므로 남은 `¨` 는 못 옮긴 표식이다(실측 `-\geq¨(\frac{1}{7})^{2}`).
RESIDUE = re.compile(r"[^\x20-\x7e가-힣\s∠△∽≤≥≠±×÷√…∴∵⋮※°⑴-⑿①-⑳❶-❺㉠-㉪㈀-㈜ㄱ-ㅎ→∼≡∥⊥⋯，、。]")
#: 보기가 **제 꼴을 갖췄나** — ① 부터 차례로, 빈 보기 없이.
#: ⚠️ 이게 없으면 그림이 얽힌 칸에서 보기가 뒤섞인 채로 통과한다
#:    (실측 `③ ④ $2 2 \sqrt5$ ⑤ $2$` — ③ 이 비었다).
CHOICE_MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"
#: 되살린 글의 한글이 지금 값의 이만큼은 돼야 한다. 밑돌면 **본문을 잃는다**.
KEEP_RATIO = 0.85
#: 본문에 든 **수**. 되살린 값이 지금 값의 수를 하나라도 잃으면 안 된다.
#: ⚠️ 한글로는 이 손실이 안 보인다 — `① 64의 제곱근 8` 이 `① 64의 제곱근` 이 돼도
#:    한글 닮음은 0.92 다. 보기 상자·그림이 얽힌 칸에서 값만 빠져나간다(실측 3-1 #77·#72).
NUMS = re.compile(r"\d+(?:\.\d+)?")


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def ko(t: str) -> str:
    return "".join(KO.findall(t or ""))


def figure_boxes(page: pymupdf.Page, clip) -> list[tuple[float, float, float, float]]:
    """칸 안 **그림의 테두리**. 가로선(분수선)은 빼고 나머지 획으로 만든다."""
    x0, y0, x1, y1 = clip
    box = None
    for d in page.get_drawings():
        for it in d["items"]:
            pts = []
            if it[0] == "l":
                if abs(it[1].y - it[2].y) < 0.6:
                    continue  # 분수선 — 그림이 아니다
                pts = [it[1], it[2]]
            elif it[0] == "c":
                pts = list(it[1:])
            elif it[0] == "re":
                r = it[1]
                if r.height <= 1.2 or r.width <= 1.2:
                    continue
                pts = [pymupdf.Point(r.x0, r.y0), pymupdf.Point(r.x1, r.y1)]
            elif it[0] == "qu":
                pts = [p for q in it[1:] for p in (q.ul, q.lr)]
            if not pts:
                continue
            cx = sum(p.x for p in pts) / len(pts)
            cy = sum(p.y for p in pts) / len(pts)
            if not (x0 - 4 <= cx <= x1 + 4 and y0 - 4 <= cy <= y1 + 4):
                continue
            for p in pts:
                box = (
                    [p.x, p.y, p.x, p.y]
                    if box is None
                    else [min(box[0], p.x), min(box[1], p.y), max(box[2], p.x), max(box[3], p.y)]
                )
    return [tuple(box)] if box else []


def side_tab_boxes(page: pymupdf.Page, clip) -> list[tuple[float, float, float, float]]:
    """옆단에 세로로 선 단원 이름 띠. 한 글자짜리가 같은 x 에 줄지어 선다."""
    x0, y0, x1, y1 = clip
    # ⚠️ **한글만** 본다. 보기 표식 ①③⑤ 도 한 글자짜리가 세로로 줄지어 서는데,
    #    그것까지 띠로 보면 **보기 번호가 통째로 사라진다**(실측: 왼쪽 열의 ①③⑤ 가
    #    전부 빠지고 ②④ 만 남았다). 단원 이름 띠는 한글이다.
    ones = [
        w for w in page.get_text("words")
        if len(w[4].strip()) == 1 and "가" <= w[4].strip() <= "힣"
        and x0 - 2 <= (w[0] + w[2]) / 2 <= x1 + 2
        and y0 - 2 <= (w[1] + w[3]) / 2 <= y1 + 2
    ]
    ones.sort(key=lambda w: (round(w[0] / TAB_X_TOL), w[1]))
    out, run = [], []
    for w in ones + [None]:
        if run and (w is None or abs(w[0] - run[0][0]) > TAB_X_TOL):
            if len(run) >= TAB_MIN:
                out.append((
                    min(t[0] for t in run) - 1, min(t[1] for t in run) - 1,
                    max(t[2] for t in run) + 1, max(t[3] for t in run) + 1,
                ))
            run = []
        if w is not None:
            run.append(w)
    return out


#: 보기 ① 바로 앞에 올 수 있는 글자. 발문은 여기서 끝난다.
BEFORE_CHOICE = "?.)!:;,"


def choices_ok(value: str) -> str | None:
    """보기가 제 꼴인가. 아니면 «왜 아닌지»를 돌려준다."""
    marks = [c for c in value if c in CHOICE_MARKS]
    if not marks:
        return None
    # ⚠️ **보기 ① 앞에 수식이 남으면** 칸을 잘못 읽은 것이다. 그림·보기 상자가 얽힌
    #    칸에서 어떤 보기의 알맹이가 발문 끝으로 흘러나오고, 그 보기는 맨 숫자만
    #    남는다(실측 3-1 #93 `것은? -\sqrt{16a^2}$ ① … ③ 8`, #173 `(정답 2개)$^{2}$ ①`).
    #    수·근호 개수로는 안 걸린다 — **자리만** 틀렸기 때문이다.
    head = value[: value.index(marks[0])].rstrip()
    if head and not (head[-1] in BEFORE_CHOICE or "가" <= head[-1] <= "힣"):
        return "보기 앞에 수식이 남았다 — 칸을 잘못 읽었다"
    want = list(CHOICE_MARKS[: len(marks)])
    if marks != want:
        return "보기 번호가 차례가 아니다"
    segs = re.split("[" + CHOICE_MARKS + "]", value)[1:]
    if any(not s.strip() for s in segs):
        return "빈 보기가 있다"
    return None


def assemble(lines: list[tuple[int, float, float, str]]) -> str:
    """줄 목록을 **발문 + 보기** 꼴로 이어 붙인다. 보기 표식에서 줄을 끊는다."""
    text = " ".join(t for _c, _y, _x, t in lines)
    parts = CHOICE.split(text)
    head = parts[0].strip()
    body = [head] if head else []
    for i in range(1, len(parts), 2):
        body.append((parts[i] + " " + parts[i + 1].strip()).strip())
    return "\n\n".join(b for b in body if b)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", type=int, default=0)
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()

    rpmlatex = load("rpmlatex", "rpm_book_latex.py")
    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    want: dict[str, list[str]] = {}
    for g in census["갈래"]:
        if not g["갈래"].startswith("content:"):
            continue
        for pid in g["id"]:
            want.setdefault(pid, []).append(g["갈래"].split(": ", 1)[1])
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId") in want
    }
    numchk = json.loads(NUMCHK.read_text(encoding="utf-8")) if NUMCHK.exists() else {}
    nowText = census["지금"]

    # 책마다 쪽 어긋남을 맞춘다 — 번호가 찍힌 쪽을 찾아 최빈값을 쓴다.
    import collections

    docs: dict[str, pymupdf.Document] = {}
    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for pid, o in origin.items():
        pdf = SRC / o["book"]
        if not pdf.exists() or not o.get("page") or not o.get("rect"):
            continue
        if o["book"] not in docs:
            docs[o["book"]] = pymupdf.open(pdf)
            print(f"  {o['book']} 열었다", flush=True)
        doc = docs[o["book"]]
        num = re.sub(r"\D", "", o.get("printedNumber") or "")
        pi = int(o["page"]) - 1
        for d in range(-8, 9):
            k = pi + d
            if 0 <= k < doc.page_count and any(w[4].strip() == num for w in doc[k].get_text("words")):
                votes[o["book"]][d] += 1
    offsets = {b: c.most_common(1)[0][0] for b, c in votes.items()}
    print("책별 쪽 어긋남:", {b[7:10]: offsets[b] for b in offsets})

    plan: list[dict] = []
    tally: dict[str, int] = {}

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    for pid, kinds in sorted(want.items()):
        o = origin.get(pid)
        cur = (nowText.get(pid) or {}).get("content")
        if not o or not o.get("rect") or not o.get("page"):
            bump("칸 좌표가 없다")
            continue
        if o["book"] not in docs:
            bump("학생용 책이 없다")
            continue
        doc = docs[o["book"]]
        pi = int(o["page"]) - 1 + offsets.get(o["book"], 0)
        if not (0 <= pi < doc.page_count):
            bump("쪽이 책 밖이다")
            continue
        page = doc[pi]
        r = o["rect"]
        clip = (r["x0"], r["y0"], r["x1"], r["y1"])
        num = re.sub(r"\D", "", o.get("printedNumber") or "")
        if not any(w[4].strip() == num for w in page.get_text("words")):
            bump("그 쪽에 번호가 없다 — 칸을 못 믿는다")
            continue
        drop = figure_boxes(page, clip) + side_tab_boxes(page, clip)
        lines = rpt.page_lines(page, columns=1, clip=clip, drop=drop)
        # 번호 자체는 본문이 아니다.
        lines = [(c, y, x, re.sub(r"^\s*" + num + r"\s*", "", t)) for c, y, x, t in lines]
        raw = assemble([ln for ln in lines if ln[3].strip()])
        if not raw.strip():
            bump("칸에서 글을 못 읽었다")
            continue
        value = rpmlatex.wrap_math(rpmlatex.to_latex(raw))
        left = sorted(set(RESIDUE.findall(value)))
        if left:
            bump(f"변환 뒤에도 원문 글자가 남는다 ({''.join(left)[:6]})")
            continue
        if ";" in value or re.search(r"\dH", value):
            bump("분수 약물·순환소수 표시를 못 옮겼다")
            continue
        ours, theirs = ko(cur), ko(value)
        sim = (
            SequenceMatcher(None, ours, theirs).ratio()
            if len(ours) >= MIN_KO_LEN and len(theirs) >= MIN_KO_LEN
            else None
        )
        if sim is not None and sim < MIN_KO_SIM:
            bump("한글이 안 닮았다 — 다른 칸일 수 있다")
            continue
        if sim is None and not numchk.get(pid, {}).get("ok"):
            bump("견줄 한글이 없고 번호 검산도 없다")
            continue
        # ⚠️ `\geq`·`\leq` 가 **왼쪽 피연산자 없이** 수식 첫머리에 서면 그건 부등호가
        #    아니라 못 옮긴 표식이다(실측 3-1 #302 `$\geqrac{3}{4}\div…`).
        if re.search(r"[$(\s]\[lg]eq(?=[\(])", value):
            bump("부등호 자리가 이상하다 — 못 옮긴 표식이다")
            continue
        if " ".join(value.split()) == " ".join((cur or "").split()):
            bump("바뀌는 것이 없다")
            continue
        why = choices_ok(value) or rpm_guards.check(value, cur)
        if why:
            bump(why)
            continue
        if ours and len(theirs) < len(ours) * KEEP_RATIO:
            bump("원문이 더 짧다 — 본문을 잃는다")
            continue
        import collections as _c

        lost = _c.Counter(NUMS.findall(cur or "")) - _c.Counter(NUMS.findall(value))
        if lost:
            bump(f"수를 잃는다 ({' '.join(sorted(lost))[:20]})")
            continue
        plan.append({
            "id": pid, "book": o["book"], "q": num, "쪽": pi + 1,
            "갈래": kinds, "sim": round(sim, 3) if sim is not None else -1,
            "current": cur, "value": value, "field": "content",
        })

    print(f"\n깨진 발문 {len(want)}행 · 되살릴 것 {len(plan)}")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  건너뜀: {k} {v}")
    for p in plan[: a.list]:
        print(f"\n═══ {p['book'][7:10]} #{p['q']} 닮음 {p['sim']} {p['갈래']}")
        print(f"  지금 {' '.join((p['current'] or '').split())[:250]}")
        print(f"  책   {' '.join(p['value'].split())[:250]}")
    if a.emit:
        OUT.write_text(json.dumps({"집계": tally, "목록": plan}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
