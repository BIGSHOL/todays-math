# -*- coding: utf-8 -*-
"""HWPX 에서 **문항별 그림 보유**를 센다. COM 불필요 — `.hwpx` 는 ZIP 이다.

왜 필요한가: 결손 문항 1,400건(단원 미분류로도 설명 안 되는 것)의 가장 유력한 원인이
적재 단계의 `skipped_figure`(그림 파일을 못 찾아 제외)다. 그러려면 **그 문항이 실제로
그림을 갖고 있었는지**를 알아야 하는데, PDF 쪽 산출물은 이 컴퓨터에 없다. HWPX 원본에는
있다.

문항 분할은 `hwp_extract.parse_exam` 과 **같은 규칙**을 쓴다 — 미주(`hp:endNote`)가
문항 앵커다. 다르게 자르면 번호가 어긋나 엉뚱한 문항에 그림을 붙이게 된다.

  python scripts/qa/hwpx_figure_map.py            # 전량 → reports/hwpx-figures.json
  python scripts/qa/hwpx_figure_map.py 2640       # 한 편만 찍어 보기

트랙 A 에게도 쓸모가 있다 — 어느 문항에 그림이 몇 장인지가 여기 다 있다.
"""
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
KEEP = pathlib.Path("scripts/qa/reports/hwpx")
OUT = pathlib.Path("scripts/qa/reports/hwpx-figures.json")
_SKIP_CTRL = {HP + "header", HP + "footer"}

# 그림 실체를 가리키는 태그·속성. `hp:pic` 은 이미지, `binaryItemIDRef` 는 BinData 참조다.
_PIC_TAGS = {HP + "pic", HP + "ole", HP + "container"}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _walk(node, out):
    """문서 순서대로 (kind, value). `hwp_extract._walk` 와 같은 골격 + 그림 이벤트."""
    for ch in node:
        if ch.tag in _SKIP_CTRL:
            continue
        if ch.tag == HP + "endNote":
            out.append(("endnote", ""))
            # 미주 **안**의 그림은 해설 그림이라 문항 그림으로 세지 않는다.
            continue
        if ch.tag in _PIC_TAGS or any(
            k.endswith("binaryItemIDRef") for k in ch.attrib
        ):
            out.append(("pic", ch.tag))
            continue
        _walk(ch, out)


def figures_of(hwpx: pathlib.Path) -> list[int]:
    """문항 번호(1부터) → 그림 개수. `parse_exam` 과 같은 미주 기준 분할."""
    items: list[tuple[str, str]] = []
    with zipfile.ZipFile(hwpx) as z:
        for s in sorted(
            n for n in z.namelist() if re.match(r"Contents/section\d+\.xml", n)
        ):
            _walk(ET.fromstring(z.read(s).decode("utf-8")), items)

    # `parse_exam` 은 첫 미주 **앞**을 버리고, 미주마다 새 문항을 연다.
    counts: list[int] = []
    cur: int | None = None
    for kind, _ in items:
        if kind == "endnote":
            if cur is not None:
                counts.append(cur)
            cur = 0
        elif kind == "pic" and cur is not None:
            cur += 1
    if cur is not None:
        counts.append(cur)
    return counts


def main() -> None:
    if len(sys.argv) > 1:
        eid = sys.argv[1]
        c = figures_of(KEEP / f"{eid}.hwpx")
        print(f"{eid}: 문항 {len(c)} · 그림 있는 문항 {sum(1 for x in c if x)}")
        print({i + 1: n for i, n in enumerate(c) if n})
        return

    files = sorted(KEEP.glob("*.hwpx"))
    out: dict[str, dict[str, int]] = {}
    n_ex = n_q = n_fig_q = n_fig = 0
    bad = 0
    for f in files:
        try:
            c = figures_of(f)
        except Exception as exc:  # noqa: BLE001
            bad += 1
            print(f"  ! {f.stem}: {type(exc).__name__} {exc}"[:110], flush=True)
            continue
        n_ex += 1
        n_q += len(c)
        out[f.stem] = {str(i + 1): n for i, n in enumerate(c) if n}
        n_fig_q += sum(1 for x in c if x)
        n_fig += sum(c)
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("── HWPX 문항별 그림 ──")
    print(f"편 {n_ex} (읽기 실패 {bad}) · 문항 {n_q}")
    print(f"그림 있는 문항 {n_fig_q} ({n_fig_q*100.0/max(1,n_q):.1f}%) · 그림 {n_fig}장")
    print("→", OUT)


if __name__ == "__main__":
    main()
