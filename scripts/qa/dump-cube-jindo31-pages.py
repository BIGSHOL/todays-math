# -*- coding: utf-8 -*-
from pathlib import Path
import sys
import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("scripts/qa/reports/cube-probe/jindo31-page-dumps.txt")

# import name has hyphen — can't import. inline decode.
EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
EHSANG_PLUS = {0x0C: "+"}


def dec(s: str) -> str:
    return "".join(
        EHSANG_DIGIT.get(ord(c), EHSANG_PLUS.get(ord(c), c)) for c in s
    )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    doc = pymupdf.open(PDF)
    parts = []
    for pno in (9, 14, 15, 24, 25, 27, 28, 149):
        t = dec(doc[pno - 1].get_text() or "")
        parts.append(f"===== p{pno} chars={len(t)} =====\n{t}\n")
    doc.close()
    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
