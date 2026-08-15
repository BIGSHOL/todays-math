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
# 정답 줄머리: `18.` `18)` `[18]` `18 ` 뒤에 답이 온다.
NUMBER_HEAD = re.compile(r"^\s*\[?(\d{1,2})\]?\s*[.)]?\s+(.*)$")
# 텍스트만으로 확정 가능한 답 — 원문자 번호이거나 짧은 값.
CIRCLED = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]$")


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
        heads = sum(1 for ln in text.splitlines() if NUMBER_HEAD.match(ln))
        if heads >= 5:
            hits.append(i)
    return hits


# 정답 앞뒤에 붙는 군더더기. 이걸 안 떼면 `[서술형 1] 54m` 이 통째로 답이 되어
# 우리 `54 m` 과 어긋난 것으로 잡힌다(실측: 값 불일치 3,006건의 다수가 이것).
PREFIX = re.compile(r"^\s*(\[[^\]]{0,20}\]|정답\s*[:：]?|답\s*[:：])\s*")
SUFFIX = re.compile(r"\s*\[[^\]]{0,40}\]\s*$")
# 해설 본문 조각. 정답면 안에도 풀이가 섞여 있어 이런 건 답으로 보면 안 된다.
NOT_ANSWER = re.compile(r"^(=|->|→|∴|따라서|즉)")


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
    # `풀이 참조` 류는 정답이 아니다 — 답이 지면에 인쇄돼 있지 않다는 뜻이다.
    if re.search(r"풀이|참조|생략|해설", head):
        return None

    # `③` 또는 `③, ⑤`
    circled = re.findall(r"[①②③④⑤⑥⑦⑧⑨⑩]", head)
    if circled and len(head) <= 12:
        return ", ".join(circled)
    # 짧은 수식·값 (풀이문이 이어지면 길어지므로 길이로 가른다)
    if len(head) <= 20 and not re.search(r"[가-힣]{4,}", head):
        return head
    return None


def extract(pdf: pathlib.Path, save_png: bool, outdir: pathlib.Path) -> dict:
    doc = fitz.open(pdf)
    try:
        pages = answer_pages(doc)
        items: dict[str, dict] = {}
        for pno in pages:
            page = doc[pno]
            for block in page.get_text("blocks"):
                x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], unpua(block[4])
                m = NUMBER_HEAD.match(text.strip())
                if not m:
                    continue
                number, rest = m.group(1), m.group(2)
                parsed = parse_answer(rest)
                # 같은 번호가 여러 번 나오면 **뒤쪽(정답면)** 을 남긴다.
                items[number] = {
                    "page": pno,
                    "text": text.strip()[:400],
                    "parsed": parsed,
                }
                if save_png and not parsed:
                    dest = outdir / str(number)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    pix = page.get_pixmap(
                        clip=fitz.Rect(x0, y0, x1, y1), dpi=200
                    )
                    pix.save(f"{dest}.png")
        return {"pages": pages, "items": items}
    finally:
        doc.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument(
        "--png",
        action="store_true",
        help="텍스트로 안 읽히는 블록을 이미지로도 남긴다(다음 회차 판독용)",
    )
    a = ap.parse_args()

    pairs = [
        p
        for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
        if p.get("pdf")
    ]
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
