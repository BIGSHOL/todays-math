# -*- coding: utf-8 -*-
"""완료본 PDF **뒤쪽 정답·해설 지면**에서 학교가 인쇄한 공식 정답을 뽑는다.

⚠️ 이 프로젝트는 오랫동안 `10-handoff.md §2.4` 의 "정답은 완료 PDF 에 없다.
완료 HWP 에 있다" 를 전제로 움직였다. **그 전제가 틀렸다.** 완료본 PDF 뒤쪽에
학교 정답·해설 지면이 통째로 들어 있는 편이 많다(2026-08-15 발견).

왜 중요한가: 우리는 정답 없는 문항을 AI 로 6,000건 넘게 풀어 채웠는데,
그 답이 학생 시험지에 인쇄된다. 실측 사례 하나만 봐도 AI 자력 계산이
`a=-3, b=2`, 공식 정답이 `a=-1, b=16/9` 로 갈렸다. **공식 정답이 있으면
그게 정본이다.** AI 풀이는 공식 정답이 없을 때만 쓴다.

  python scripts/qa/extract-official-answers.py --limit 30
  python scripts/qa/extract-official-answers.py            전량

출력: scripts/qa/reports/official-answers/<examId>.json
  {"examId": 4209, "pages": [12,13], "items": {"18": {"text": "...", "parsed": "③"}}}

판독은 여기서 하지 않는다. **텍스트로 바로 읽히는 것만 `parsed` 로 내고**,
안 읽히는 것은 `text`(블록 원문)와 잘라낸 이미지를 남겨 다음 회차가 본다.
그래야 수천 편을 한 번에 돌릴 수 있다.
"""
import argparse
import collections
import json
import pathlib
import re
import sys

import fitz  # PyMuPDF

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

PAIRS = "scripts/qa/reports/final-pairs.json"

# ⚠️ 완료본 PDF 의 텍스트 레이어는 한글은 멀쩡한데 **수식만 HWP 수식폰트의
# 사용자영역(PUA, U+E0xx)** 으로 들어 있다. 되돌리지 않으면 정답이
# `` 처럼 깨져 나오고, 우리 정답과 대조하면 전부 불일치로 잡힌다
# (실측: 값 형태 불일치 2,684건이 거의 다 이 문제였다).
# 표는 testchanger 가 실측으로 유도해 둔 것을 그대로 쓴다 — 직접 만들지 말 것.
_PUA = json.loads(
    (testchanger_dir() / "db" / "pua_table.json").read_text(encoding="utf-8")
)["map"]
PUA_MAP = {chr(int(code, 16)): ch for code, ch in _PUA.items()}


def unpua(text: str) -> str:
    """HWP 수식폰트 PUA 코드를 사람이 읽는 문자로 되돌린다."""
    return "".join(PUA_MAP.get(ch, ch) for ch in text)
OUTDIR = pathlib.Path("scripts/qa/reports/official-answers")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 정답면을 알아보는 표지. 본문 지면에도 "해설" 이 스칠 수 있어 둘 이상을 본다.
ANSWER_PAGE = re.compile(r"정\s*답|해\s*설|채점\s*기준|모범\s*답안")
# ⚠️ **문제 지면**을 알아보는 표지. 안내문 "모든 문항의 정답은 1개다" 가
# ANSWER_PAGE 에 걸려 문제 지면이 정답면으로 오인되는 사고가 있었다(실측 3766).
# 그 지면의 분수 글리프가 줄바꿈으로 쪼개져 `1\n② ⁄9` 가 되고, 그게 "1번 답 ②" 로
# 읽혀 진짜 정답(⑤)을 덮었다. 문제 지면 표지가 보이면 정답면으로 보지 않는다.
PROBLEM_PAGE = re.compile(r"\[중단원\]|\[난이도\]|\[\s*\d+\s*점\s*\]|배점")
# 정답 줄머리: `18.` `18)` `[18]` 뒤에 답이 온다.
#
# ⚠️ 구분자(`.` `)` `]`)를 **필수**로 둔다. 선택적으로 뒀더니 해설 문장
# `1 을 ②에 대입하면` 이 "1번 답 ②" 로 읽혀 진짜 정답 ①을 덮었다(실측 3307).
# 정답 목록은 예외 없이 `1. ⑤` 형식이라 이걸 강제해도 놓치는 게 거의 없다.
NUMBER_HEAD = re.compile(r"^\s*(?:\[(\d{1,2})\]|(\d{1,2})\s*[.)])\s*(.*)$")
# 텍스트만으로 확정 가능한 답 — 원문자 번호이거나 짧은 값.
CIRCLED = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]$")


# 정답 목록의 지문 — `1. ④` 처럼 **번호와 원문자만** 있는 줄.
# 문제 지면에는 이런 줄이 거의 없다(실측: 오검출로 유명한 3766 p3 은 0줄,
# 진짜 정답면은 14~17줄). 문제지면 표지를 뒤집을 근거로 이것만 쓴다.
ANSWER_LINE = re.compile(r"^\s*\d{1,2}\s*[.)]\s*[①-⑩]\s*$")


def answer_pages(doc: fitz.Document) -> list[int]:
    """정답·해설 지면 번호. 뒤쪽부터 훑되 본문 지면은 제외한다."""
    hits = []
    for i in range(doc.page_count):
        text = unpua(doc[i].get_text())
        if not text.strip():
            continue
        # 표지어가 있고 **문항 줄머리가 촘촘한** 지면만 정답면으로 본다.
        if not ANSWER_PAGE.search(text[:400]):
            continue
        lines = text.splitlines()
        answer_lines = sum(1 for ln in lines if ANSWER_LINE.match(ln))
        # 문제 지면 표지가 있으면 정답면이 아니다.
        #
        # ⚠️ 다만 **정답 목록이 뚜렷하면 표지를 뒤집는다.** 해설에 배점표가 붙은
        # 정답면이 `[1점]` 때문에 통째로 버려져 시험지 3편(3681·5404·5687)의
        # 정답면을 잃고 있었다(실측, 지면 렌더로 확인). 문제 지면은 이 줄이 0이라
        # 원래 막으려던 오검출(3766 p3)은 그대로 막힌다.
        if PROBLEM_PAGE.search(text) and answer_lines < 5:
            continue
        heads = sum(1 for ln in lines if NUMBER_HEAD.match(ln))
        if heads >= 5:
            hits.append(i)
    return hits


# 정답 앞뒤에 붙는 군더더기. 이걸 안 떼면 `[서술형 1] 54m` 이 통째로 답이 되어
# 우리 `54 m` 과 어긋난 것으로 잡힌다(실측: 값 불일치 3,006건의 다수가 이것).
PREFIX = re.compile(r"^\s*(\[[^\]]{0,20}\]|정답\s*[:：]?|답\s*[:：])\s*")
SUFFIX = re.compile(r"\s*\[[^\]]{0,40}\]\s*$")
# 해설 본문 조각. 정답면 안에도 풀이가 섞여 있어 이런 건 답으로 보면 안 된다.
NOT_ANSWER = re.compile(r"^(=|->|→|∴|따라서|즉)")


# 소문항 번호. 여럿이면 답이 길어져도 풀이문이 아니라 **답 목록**이다.
PART_HEAD = re.compile(r"[⑴-⑽]|\(\s*\d\s*\)")
# 답이 지면에 안 실렸다는 뜻의 문구. **그것만** 있을 때 정답 없음으로 본다.
SEE_SOLUTION = re.compile(r"(?:풀이|해설)\s*(?:참조|참고)|참조\s*$|생략")


def parse_answer(rest: str) -> str | None:
    """블록 첫 줄에서 확정적으로 읽히는 답만 돌려준다. 애매하면 None."""
    head = rest.strip().split("\n")[0].strip()
    # `[서술형 1] 정답 : 54m` → `54m`. 접두어가 겹쳐 붙는 편이 있어 반복해서 뗀다.
    for _ in range(3):
        stripped = PREFIX.sub("", head).strip()
        if stripped == head:
            break
        head = stripped
    head = SUFFIX.sub("", head).strip()

    if not head or NOT_ANSWER.match(head):
        return None

    parts = PART_HEAD.findall(head)
    # `풀이 참조` 류는 정답이 아니다 — 답이 지면에 인쇄돼 있지 않다는 뜻이다.
    #
    # ⚠️ 예전에는 `풀이|참조|생략|해설` 이 **어디든** 있으면 통째로 버렸다. 그래서
    # `⑴ 해설참조 ⑵ <,<,>` `(1) 풀이참고 (2) 참 ⑶ 거짓` 처럼 **일부 소문항만**
    # 풀이참조인 답이 전부 날아갔다(실측 108건 중 다수). 소문항이 둘 이상이면
    # 남은 소문항에 진짜 답이 있으므로 버리지 않는다.
    if SEE_SOLUTION.search(head):
        if len(parts) < 2:
            return None
        # 소문항이 전부 풀이참조면 역시 정답이 없는 것이다.
        if not re.search(r"[0-9①-⑩=<>√π]", SEE_SOLUTION.sub("", head)):
            return None

    # `③` 또는 `③, ⑤`
    circled = re.findall(r"[①②③④⑤⑥⑦⑧⑨⑩]", head)
    if circled and len(head) <= 12:
        return ", ".join(circled)
    # 짧은 수식·값 (풀이문이 이어지면 길어지므로 길이로 가른다).
    # 소문항이 여럿이면 그만큼 길어지는 게 정상이라 한도를 소문항 수에 맞춰 늘린다.
    limit = 20 if len(parts) < 2 else 20 * len(parts)
    if len(head) <= limit and not re.search(r"[가-힣]{4,}", head):
        return head
    return None


def extract(pdf: pathlib.Path, save_png: bool, outdir: pathlib.Path) -> dict:
    doc = fitz.open(pdf)
    try:
        pages = answer_pages(doc)
        items: dict[str, dict] = {}
        # ⚠️ 정답 목록은 지면 **위쪽**에 `1. ④` 처럼 정연하게 있고, 아래는 해설이다.
        # 해설 안에도 `1 ⋯③` 같은 조각이 나와 같은 번호로 잡힌다. 처음엔 "뒤에 나온
        # 것을 남긴다"고 했는데 그게 거꾸로였다 — 해설 조각이 진짜 정답을 덮었다
        # (실측: 3175-1 은 지면에 `1. ④` 인데 `③` 으로 뽑혔다).
        # 그래서 **한 지면 안에서는 위쪽(y 오름차순)을 우선**한다.
        #
        # 지면 사이에서는 반대로 **뒤쪽 지면을 우선**한다. 정답면이 여럿 잡힌
        # 시험지가 2,242편 중 55편인데, 앞쪽에 걸린 것은 대개 오검출(문제 지면)이고
        # 진짜 정답면은 맨 뒤다. 앞쪽을 우선하면 가짜가 진짜를 덮는다(실측 3766).
        blocks = []
        for pno in pages:
            for block in doc[pno].get_text("blocks"):
                blocks.append((pno, block))
        blocks.sort(key=lambda pb: (-pb[0], pb[1][1]))

        for pno, block in blocks:
            x0, y0, x1, y1, text = (
                block[0],
                block[1],
                block[2],
                block[3],
                unpua(block[4]),
            )
            m = NUMBER_HEAD.match(text.strip())
            if not m:
                continue
            number = m.group(1) or m.group(2)
            rest = m.group(3)
            if number in items:
                continue
            parsed = parse_answer(rest)
            items[number] = {
                "page": pno,
                "text": text.strip()[:400],
                "parsed": parsed,
            }
            if save_png and not parsed:
                dest = outdir / str(number)
                dest.parent.mkdir(parents=True, exist_ok=True)
                pix = doc[pno].get_pixmap(clip=fitz.Rect(x0, y0, x1, y1), dpi=200)
                pix.save(f"{dest}.png")
        return {"pages": pages, "items": items}
    finally:
        doc.close()


def reparse() -> None:
    """이미 뽑아 둔 산출물의 `text` 로 `parsed` 만 다시 계산한다.

    `parse_answer` 를 고쳤을 때 2,240편을 다시 열 필요가 없다(토큰 0·수십 분 절약).
    블록을 고르는 규칙(지면 판정·줄머리·지면 내 순서)은 **건드리지 않는다** —
    그 다섯 실패는 이미 한 번씩 겪었고 다시 열면 진짜 정답이 가짜에 덮인다.
    """
    stat = collections.Counter()
    for path in sorted(OUTDIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for number, item in doc.get("items", {}).items():
            before = item.get("parsed")
            head = item.get("text", "")
            m = NUMBER_HEAD.match(head.strip())
            after = parse_answer(m.group(3)) if m else None
            stat["문항"] += 1
            if before == after:
                continue
            changed = True
            if before is None and after is not None:
                stat["새로 읽힘"] += 1
            elif before is not None and after is None:
                stat["읽던 것을 잃음"] += 1
            else:
                stat["값이 바뀜"] += 1
            item["parsed"] = after
        if changed:
            path.write_text(
                json.dumps(doc, ensure_ascii=False), encoding="utf-8"
            )
            stat["고친 편"] += 1
    print("\n── 다시 읽기 (PDF 재열람 없음) ──")
    for key, n in stat.most_common():
        print(f"  {key} {n}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=None, help="산출 디렉터리 (기본은 official-answers)")
    ap.add_argument(
        "--ids",
        default=None,
        help="쉼표로 나눈 examId 만 다시 뽑는다(이미 있는 산출물은 덮어쓴다)",
    )
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument(
        "--reparse",
        action="store_true",
        help="PDF 를 다시 열지 않고 이미 뽑아 둔 블록 원문(text)으로 parsed 만 다시 계산한다",
    )
    ap.add_argument(
        "--png",
        action="store_true",
        help="텍스트로 안 읽히는 블록을 이미지로도 남긴다(다음 회차 판독용)",
    )
    a = ap.parse_args()

    global OUTDIR
    if a.out:
        OUTDIR = pathlib.Path(a.out)

    if a.reparse:
        reparse()
        return

    pairs = [
        p
        for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
        if p.get("pdf")
    ]
    if a.ids:
        want = {int(x) for x in a.ids.split(",") if x.strip()}
        pairs = [p for p in pairs if p["examId"] in want]
    if a.limit:
        pairs = pairs[a.offset : a.offset + a.limit]

    OUTDIR.mkdir(parents=True, exist_ok=True)
    stat = collections.Counter()
    for i, pair in enumerate(pairs, 1):
        eid = pair["examId"]
        pdf = pathlib.Path(pair["pdf"])
        if not pdf.exists():
            stat["원본 없음"] += 1
            continue
        try:
            result = extract(pdf, a.png, OUTDIR / str(eid))
        except Exception as exc:  # noqa: BLE001
            stat["실패"] += 1
            if stat["실패"] <= 3:
                print(f"  ! {eid} {type(exc).__name__}")
            continue

        if not result["pages"]:
            stat["정답면 없음"] += 1
            continue
        stat["정답면 있음"] += 1
        stat["문항"] += len(result["items"])
        stat["텍스트로 확정"] += sum(
            1 for v in result["items"].values() if v["parsed"]
        )
        (OUTDIR / f"{eid}.json").write_text(
            json.dumps({"examId": eid, **result}, ensure_ascii=False),
            encoding="utf-8",
        )
        if i % 50 == 0:
            print(f"  {i}/{len(pairs)}편")

    total = stat["문항"]
    print("\n── 완료본 PDF 공식 정답 추출 ──")
    print(f"대상 {len(pairs)}편 · 정답면 있음 {stat['정답면 있음']}"
          f" · 정답면 없음 {stat['정답면 없음']}"
          f" · 원본 없음 {stat['원본 없음']} · 실패 {stat['실패']}")
    if total:
        pct = stat["텍스트로 확정"] * 100 / total
        print(f"추출 문항 {total} · 텍스트로 바로 확정 {stat['텍스트로 확정']} ({pct:.1f}%)")
    print(f"→ {OUTDIR}")


if __name__ == "__main__":
    main()
