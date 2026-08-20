# -*- coding: utf-8 -*-
"""기출 PDF 전량에 map_exam() 만 돌려 네이티브/폴백을 센다. 쓰지 않는다.

확장자로 나누지 않는다. 결과는 보고서 항목 4 의 분모가 된다.
재개 가능: 이미 센 편은 JSON 에 있으면 건너뛴다. 실패는 횟수를 적는다.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "scripts" / "figure" / "figure-manifest.json"
IDX = Path(r"F:\시험지변환기\db\exam_index.db")
OUT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "native-census.json"

HERE = ROOT / "scripts" / "figure"
spec = importlib.util.spec_from_file_location("mapfig", HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapfig)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    con = sqlite3.connect(str(IDX))
    src = {str(eid): s for eid, s in con.execute("select id, src_path from exams")}
    ids = sorted(
        (e for e in manifest if e.isdigit() and (src.get(e) or "").lower().endswith(".pdf")),
        key=int,
    )
    if limit:
        # 균등 표본
        step = len(ids) / limit
        ids = [ids[int(i * step)] for i in range(limit)]

    state = {"편": {}, "포기": []}
    if OUT.exists():
        state = json.loads(OUT.read_text(encoding="utf-8"))
        if "편" not in state:
            state = {"편": {}, "포기": []}

    t0 = time.perf_counter()
    done = 0
    for eid in ids:
        if eid in state["편"] and state["편"][eid].get("ok"):
            continue
        prev = state["편"].get(eid, {"tries": 0})
        tries = int(prev.get("tries", 0)) + 1
        pdf = Path(src[eid])
        rec = {"tries": tries, "pdf": str(pdf)}
        if not pdf.exists():
            rec["ok"] = False
            rec["이유"] = "원본 없음"
            state["편"][eid] = rec
            if tries >= 3:
                state["포기"].append(eid)
            continue
        try:
            mapped = mapfig.map_exam(pdf)
        except Exception as exc:  # noqa: BLE001
            rec["ok"] = False
            rec["이유"] = type(exc).__name__
            rec["메시지"] = repr(exc)[:160]
            state["편"][eid] = rec
            if tries >= 3:
                state["포기"].append(eid)
            print(f"  ! {eid} {type(exc).__name__} try {tries}")
            continue
        yes = no = 0
        for figs in mapped.values():
            for f in figs:
                if f.get("xref"):
                    yes += 1
                else:
                    no += 1
        rec.update({"ok": True, "네이티브": yes, "폴백": no, "그림": yes + no})
        state["편"][eid] = rec
        done += 1
        if done % 25 == 0:
            OUT.parent.mkdir(parents=True, exist_ok=True)
            OUT.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            print(f"  … {done}편 추가 · 누적 {sum(1 for v in state['편'].values() if v.get('ok'))}")

    yes = no = fail = 0
    for rec in state["편"].values():
        if rec.get("ok"):
            yes += rec.get("네이티브", 0)
            no += rec.get("폴백", 0)
        else:
            fail += 1
    ok_n = sum(1 for v in state["편"].values() if v.get("ok"))
    state["집계"] = {
        "대상편": len(ids),
        "성공편": ok_n,
        "실패편": fail,
        "포기편": len(state["포기"]),
        "네이티브": yes,
        "폴백": no,
        "그림": yes + no,
        "네이티브비율": round(100 * yes / (yes + no), 1) if (yes + no) else None,
        "초": round(time.perf_counter() - t0, 1),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    c = state["집계"]
    print(
        f"── 네이티브 센서스 ── 성공 {c['성공편']}/{c['대상편']}편 · "
        f"그림 {c['그림']} · 네이티브 {c['네이티브']} · 폴백 {c['폴백']} "
        f"({c['네이티브비율']}%) · 실패 {c['실패편']} · 포기 {c['포기편']} · {c['초']}s"
    )
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
