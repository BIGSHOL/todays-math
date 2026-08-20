# -*- coding: utf-8 -*-
"""쪽 장식 제외(`--furniture`)와 그 둘레의 가드를 합성 지면으로 시험한다.

    python scripts/qa/test-rpm-furniture.py

## 무엇을 지키나

RPM 교재는 쪽 오른쪽 여백에 **측면 색인 탭**(`04 다각형`)을 찍는다. 그 탭이
「오른쪽 그림」 문항의 `bleed`(±60pt) 안에 들어와, 완비 검사가 **「칸 경계를
가로지른다」로 그 문항을 통째로 버렸다** — 실측 36행 중 18행이 그 하나였다.

탭은 낱말로 못 가른다(글자가 아니라 획이다). 가르는 성질은 **되풀이**다 —
쪽마다 같은 자리에 나온다. 그 판정이 `furniture_keys` 고, 정의는
`crop-rpm-from-pdf.py` **한 곳**에 있다(`crop-pdf-by-stem.py` 는 그것을 그대로 쓴다).

| 지키는 것 | 왜 |
|---|---|
| 되풀이되는 획만 뺀다 | 한 번만 나오는 진짜 그림은 안 걸린다 |
| **세는 쪽과 거르는 쪽이 같은 반올림**을 쓴다 | 예전엔 `figure_rect` 에 `3` 이 손으로<br>적혀 있었다 — 상수를 고치면 둘이 조용히 갈라진다 |
| `narrow()` 가 **이미 그림이 있는 행**을 뺀다 | 오려내기는 계획 전량을 돈다.<br>그대로 붙이면 87행 중 **69행을 덮어쓴다** (2026-08-18 「43이 433」) |
| 분모가 안 맞으면 **멈춘다** | 조용히 사라진 행이 있으면 표가 「전부 해 봤다」로 읽힌다 |
| 판정 없는 행이 있으면 **멈춘다** | 조용히 붙이지도, 조용히 빼지도 않는다 |
| 「이미있음」을 결과에 **적는다** | 그 파일은 다른 설정으로 돈 예전 실행이 남긴 것일 수<br>있다 — 실측 3건이 지금 오릴 칸과 다른 그림이었다 |

⚠️ 변이 시험은 `scripts/qa/mutate-rpm-furniture.sh` 에 있다.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile

import fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load(name: str, rel: str):
    s = importlib.util.spec_from_file_location(name, _ROOT / rel)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


crop = _load("croprpm", "figure/crop-rpm-from-pdf.py")
apply_mod = _load("applyfurn", "figure/apply-rpm-furniture.py")

W, H = 595.0, 842.0
FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  OK  {name}")
    else:
        FAILS.append(name)
        print(f"  --  {name}  {detail}")


#: 지면에 **되풀이**되는 탭. RPM 실측은 `[581.1, 184.3, 632.1, 212.6]` 이다 —
#: 쪽 오른쪽 여백이라 「단을 가로지른다」에도 「쪽을 덮는다」에도 안 걸린다.
#:
#: ⚠️ **자리를 아무 데나 잡으면 이 시험이 거짓 초록이 된다.** 탭이 문항 상자에
#:    안 닿으면 애초에 후보로도 안 잡혀(`(r & box).is_empty`) 완비 검사가 볼 일이
#:    없다. 실제 지면이 그런 모양이 아니다 — 탭은 상자에 **걸치고** `bleed`(±60pt)
#:    **밖까지 뻗는다.** 그래서 삼킬 수도 없다. 그 두 조건을 여기서 만든다.
TAB = fitz.Rect(380, 250, 460, 278)
#: 문항의 진짜 그림 — 한 쪽에만 있다.
FIG = fitz.Rect(300, 240, 370, 300)


def _book(pages: int = 3) -> fitz.Document:
    """탭은 모든 쪽에, 그림은 첫 쪽에만."""
    doc = fitz.open()
    for i in range(pages):
        p = doc.new_page(width=W, height=H)
        p.draw_rect(TAB, color=(0.9, 0.4, 0.4), fill=(0.9, 0.4, 0.4), width=0.5)
        if i == 0:
            p.draw_rect(FIG, width=0.8)
    return doc


# ─────────────────────────────────────────────────────────────────────────
def t_keys() -> None:
    print("\n-- 되풀이로 가른다 --")
    doc = _book()
    keys = crop.furniture_keys(doc)
    k = lambda r: tuple(int(round(v / crop.FURNITURE_ROUND)) for v in r)
    check("여러 쪽에 되풀이되는 탭은 장식이다", k(TAB) in keys)
    check("한 쪽에만 있는 그림은 장식이 아니다", k(FIG) not in keys)
    doc.close()


def t_drops_tab() -> None:
    print("\n-- 탭이 칸 경계를 가로지르면 그 문항이 통째로 버려진다 --")
    doc = _book()
    page = doc[0]
    keys = crop.furniture_keys(doc)
    box = fitz.Rect(295, 235, 385, 305)   # 그림만 감싸는 문항 상자
    off = crop.figure_rect(page, box, "", min_size=(8.0, 8.0))
    on = crop.figure_rect(page, box, "", min_size=(8.0, 8.0), furniture=keys)
    check("장식을 모르면 못 오린다 (완비 검사가 버린다)", off is None, f"={off}")
    check("장식을 빼면 오린다", on is not None, f"={on}")
    if on is not None:
        check("오린 칸에 탭이 안 들어온다", (on & TAB).is_empty,
              f"={[round(v, 1) for v in on]}")
        check("그림은 온전하다", on.contains(FIG),
              f"={[round(v, 1) for v in on]}")
    doc.close()


def t_same_round() -> None:
    """세는 쪽과 거르는 쪽이 **같은 반올림**을 쓰는가.

    `figure_rect` 안에 `3` 이 손으로 적혀 있으면, 상수를 바꾼 순간 열쇠가 어긋나
    장식이 그림으로 딸려 온다. 상수를 바꿔 놓고도 여전히 걸러지는지 본다.
    """
    print("\n-- 두 곳이 한 숫자를 쓴다 --")
    old = crop.FURNITURE_ROUND
    try:
        crop.FURNITURE_ROUND = 7          # 손으로 적힌 3 이 있으면 여기서 갈라진다
        doc = _book()
        keys = crop.furniture_keys(doc)
        on = crop.figure_rect(doc[0], fitz.Rect(295, 235, 385, 305), "",
                              min_size=(8.0, 8.0), furniture=keys)
        check("반올림을 바꿔도 둘이 같이 움직인다", on is not None and (on & TAB).is_empty,
              f"={None if on is None else [round(v, 1) for v in on]}")
        doc.close()
    finally:
        crop.FURNITURE_ROUND = old


def t_one_place() -> None:
    print("\n-- 정의는 한 곳뿐이다 --")
    stem = _load("cropstem", "figure/crop-pdf-by-stem.py")
    # 두 모듈은 `importlib` 로 각각 실행돼 함수 **객체**는 다르다. 지켜야 할 것은
    # 그것이 아니라 **정의가 한 파일에만 있다**는 것이다 — 그래서 소스 파일을 본다.
    check("`crop-pdf-by-stem` 의 furniture_keys 는 crop-rpm 에서 온다",
          pathlib.Path(stem.furniture_keys.__code__.co_filename).name
          == "crop-rpm-from-pdf.py",
          f"={stem.furniture_keys.__code__.co_filename}")
    check("반올림 상수도 같은 값을 쓴다",
          stem.FURNITURE_ROUND == crop.FURNITURE_ROUND
          and stem.FURNITURE_MIN_PAGES == crop.FURNITURE_MIN_PAGES)


def t_narrow() -> None:
    """붙일 대상을 **다시 좁힌다** — 이미 그림이 있는 행을 덮어쓰지 않는다."""
    print("\n-- 넓게 돈 결과를 처리 대상으로 물려받지 않는다 --")
    pid2ext = {"p1": "e1", "p2": "e2", "p3": "e3"}
    results = [{"성공": [{"problemId": "p1", "publicPath": "/a.png"},
                         {"problemId": "p2", "publicPath": "/b.png"}]},
               {"성공": [{"problemId": "p3", "publicPath": "/c.png"}]}]
    keep, why = apply_mod.narrow(results, pid2ext, {"e2"})
    check("유실인 행만 남는다", [r["externalId"] for r in keep] == ["e2"],
          f"={[r['externalId'] for r in keep]}")
    check("뺀 것을 세어서 남긴다", why["그림이 이미 있다"] == 2, f"={why}")
    check("남긴 것 + 뺀 것 == 분모", len(keep) + sum(why.values()) == 3)
    # 계획에 없는 problemId 는 **조용히 사라지면 안 된다** — 세어서 남긴다.
    keep2, why2 = apply_mod.narrow(results, {"p1": "e1"}, {"e1"})
    check("계획에 없는 행도 세어서 남긴다",
          len(keep2) + sum(why2.values()) == 3, f"={why2}")


def t_decision_gate() -> None:
    print("\n-- 판정이 없으면 멈춘다 --")
    keep = [{"externalId": "e1"}, {"externalId": "e2"}]
    check("판정이 빠진 행을 집어낸다",
          apply_mod.missing_decisions(keep, {"e1": {"판정": "쓴다"}}) == ["e2"])
    check("다 있으면 빈 목록",
          apply_mod.missing_decisions(keep, {"e1": {}, "e2": {}}) == [])


def t_already_marked() -> None:
    """「이미있음」이 결과에 **적히는가** — 실제로 두 번 돌려 본다."""
    print("\n-- 「이미있음」은 「같은 것이 이미 있다」가 아니다 --")
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        # 쪽이 하나면 탭이 **되풀이되지 않아** 장식으로 안 걸린다 — 그러면
        # 오려내기가 실패해 이 시험이 「이미있음」에 닿지도 못한다.
        doc = _book()
        pdf = d / "book.pdf"
        doc.save(str(pdf)); doc.close()
        out = d / "public" / "x" / "0.png"
        plan = {"목록": [{"problemId": "p1", "externalId": "e1", "pdf": str(pdf),
                          "page": 1, "rect": [295, 235, 385, 305], "out": str(out)}]}
        plan_p = d / "plan.json"
        plan_p.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        content_p = d / "content.json"
        content_p.write_text("{}", encoding="utf-8")
        res = d / "res.json"
        cmd = [sys.executable, str(_ROOT / "figure" / "crop-rpm-from-pdf.py"),
               "--plan", str(plan_p), "--out", str(res),
               "--content", str(content_p), "--furniture"]
        subprocess.run(cmd, cwd=_ROOT.parent, capture_output=True)
        first = json.loads(res.read_text(encoding="utf-8"))
        subprocess.run(cmd, cwd=_ROOT.parent, capture_output=True)
        second = json.loads(res.read_text(encoding="utf-8"))
        check("처음엔 오려서 칸이 남는다",
              first["성공수"] == 1 and first["성공"][0].get("칸") is not None,
              f"={first}")
        check("두 번째는 이미있음으로 센다", second["이미있음"] == 1, f"={second}")
        check("그 행에 「이미있음」이 적힌다",
              second["성공"][0].get("이미있음") is True, f"={second['성공'][0]}")


def main() -> None:
    for t in (t_keys, t_drops_tab, t_same_round, t_one_place,
              t_narrow, t_decision_gate, t_already_marked):
        t()
    print()
    if FAILS:
        print(f"🔴 실패 {len(FAILS)}건")
        for f in FAILS:
            print("   " + f)
        sys.exit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
