# -*- coding: utf-8 -*-
"""대장 있는 기출 PDF 전량의 --from-pairs 목록을 만든다. 읽기만."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "scripts" / "figure" / "figure-manifest.json"
IDX = Path(r"F:\시험지변환기\db\exam_index.db")
OUT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "recrop-pairs.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    con = sqlite3.connect(str(IDX))
    src = {str(eid): s for eid, s in con.execute("select id, src_path from exams")}
    pairs = []
    missing = []
    not_pdf = []
    for eid in sorted(manifest, key=lambda x: int(x) if x.isdigit() else 0):
        s = src.get(eid) or ""
        if not s.lower().endswith(".pdf"):
            not_pdf.append(eid)
            continue
        p = Path(s)
        if not p.exists():
            missing.append(eid)
            continue
        pairs.append({"examId": eid, "pdf": s})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "기준": "figure-manifest ∩ exam_index.src_path 가 디스크에 있는 PDF",
                "편": len(pairs),
                "원본없음": missing,
                "PDF아님": not_pdf,
                "pairs": pairs,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"pairs {len(pairs)} · 원본없음 {len(missing)} · PDF아님 {len(not_pdf)} → {OUT}")


if __name__ == "__main__":
    main()
