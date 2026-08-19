# -*- coding: utf-8 -*-
"""㉮ 비용 2·3·4 — 편 10개를 실제로 돌려 시간·디스크·네이티브를 잰다.

기존 추출기를 그대로 부른다. 규칙을 여기 옮기지 않는다.
public/figures 를 덮지 않는다. 기존 figure-manifest.json 을 덮지 않는다.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / "public" / "figures"
MANIFEST = ROOT / "scripts" / "figure" / "figure-manifest.json"
IDX = Path(r"F:\시험지변환기\db\exam_index.db")
OUT_DIR = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster"
PAIRS = OUT_DIR / "cost10-pairs.json"
COST = OUT_DIR / "cost10.json"
EXTRACT = ROOT / "scripts" / "figure" / "extract-all-figures.py"
NEW_ROOT = ROOT / "public" / "figures-300"
NEW_MANIFEST = OUT_DIR / "figure-300-manifest.json"

HERE = ROOT / "scripts" / "figure"
spec = importlib.util.spec_from_file_location("mapfig", HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapfig)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def src_of() -> dict[str, str]:
    con = sqlite3.connect(str(IDX))
    return {str(eid): src for eid, src in con.execute("select id, src_path from exams")}


def pick_ten(manifest: dict, src: dict[str, str]) -> list[str]:
    """대장 있는 PDF 편을 번호순으로 고르게 10편."""
    ids = sorted(
        (e for e in manifest if e.isdigit() and (src.get(e) or "").lower().endswith(".pdf")),
        key=int,
    )
    if len(ids) < 10:
        raise SystemExit(f"PDF 편이 10편보다 적다: {len(ids)}")
    step = len(ids) / 10
    picked = [ids[int(i * step)] for i in range(10)]
    # 중복이 생기면(편 수가 적을 때) 앞에서부터 채운다.
    out: list[str] = []
    for e in picked:
        if e not in out:
            out.append(e)
    i = 0
    while len(out) < 10:
        if ids[i] not in out:
            out.append(ids[i])
        i += 1
    return out


def dir_bytes(d: Path) -> int:
    if not d.is_dir():
        return 0
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    src = src_of()
    ten = pick_ten(manifest, src)
    pairs = [{"examId": e, "pdf": src[e]} for e in ten]
    for p in pairs:
        pdf = Path(p["pdf"])
        print(f"  편 {p['examId']}  exists={pdf.exists()}  {pdf.name}")
        if not pdf.exists():
            raise SystemExit(f"원본이 없다: {pdf}")
    PAIRS.write_text(
        json.dumps({"기준": "비용 10편 — 대장 PDF 를 번호순 균등", "pairs": pairs}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    # 4. 네이티브 vs 폴백 — map_exam 만. 확장자로 나누지 않는다.
    xref_yes = xref_no = fail = 0
    per: list[dict] = []
    t_map0 = time.perf_counter()
    for p in pairs:
        t0 = time.perf_counter()
        try:
            mapped = mapfig.map_exam(Path(p["pdf"]))
        except Exception as exc:  # noqa: BLE001
            fail += 1
            per.append({"examId": p["examId"], "실패": type(exc).__name__})
            print(f"  map 실패 {p['examId']} {type(exc).__name__}")
            continue
        yes = no = 0
        for figs in mapped.values():
            for f in figs:
                if f.get("xref"):
                    yes += 1
                else:
                    no += 1
        xref_yes += yes
        xref_no += no
        dt = time.perf_counter() - t0
        old_b = dir_bytes(FIG / p["examId"])
        per.append(
            {
                "examId": p["examId"],
                "map초": round(dt, 3),
                "그림": yes + no,
                "네이티브": yes,
                "폴백": no,
                "지금바이트": old_b,
                "pdf": p["pdf"],
            }
        )
        print(
            f"  map {p['examId']}  {dt:.2f}s  그림 {yes+no}  네이티브 {yes}  폴백 {no}"
        )
    t_map = time.perf_counter() - t_map0

    # 2·3. 같은 10편을 추출기에 넘긴다 — 300dpi · PNG · 새 디렉터리.
    NEW_ROOT.mkdir(parents=True, exist_ok=True)
    t_ex0 = time.perf_counter()
    cmd = [
        sys.executable,
        str(EXTRACT),
        "--from-pairs",
        str(PAIRS),
        "--dpi",
        "300",
        "--png",
        "--out",
        str(NEW_ROOT),
        "--manifest",
        str(NEW_MANIFEST),
    ]
    print("실행:", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8")
    t_ex = time.perf_counter() - t_ex0
    print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr)
        raise SystemExit(f"추출기 실패 exit {proc.returncode}")

    new_total = 0
    old_total = 0
    for row in per:
        if "실패" in row:
            continue
        eid = row["examId"]
        nb = dir_bytes(NEW_ROOT / eid)
        row["새바이트"] = nb
        row["배수"] = round(nb / row["지금바이트"], 3) if row["지금바이트"] else None
        new_total += nb
        old_total += row["지금바이트"]
        print(
            f"  disk {eid}  지금 {row['지금바이트']/1024:.0f}KB → "
            f"{nb/1024:.0f}KB  ×{row['배수']}"
        )

    n_pdf = 1896  # 분모 실측(대장 있는 PDF). 여기 숫자와 보고서 항목 1 이 같아야 한다.
    cost = {
        "기준": "대장 있는 PDF 1,896편에서 번호순 균등 10편. 추출기는 extract-all-figures.py 그대로.",
        "시각": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "편": ten,
        "map초_10편": round(t_map, 3),
        "추출초_10편": round(t_ex, 3),
        "외삽_추출초_1896편": f"10편 실측 {t_ex:.1f}s × {n_pdf / 10:.1f} = {t_ex * n_pdf / 10:.0f}s",
        "외삽근거": "10편 실측 × (1896/10). 선형. 편이 더 두꺼운 꼬리는 못 봤다.",
        "지금바이트_10편": old_total,
        "새바이트_10편": new_total,
        "배수_10편": round(new_total / old_total, 3) if old_total else None,
        "외삽_디스크": (
            f"10편 실측 ×{new_total / old_total:.3f} — 전량 기출 PDF 분에만 적용. "
            "HWP 996장·RPM 1,703장은 이 배수에 넣지 않는다."
            if old_total
            else None
        ),
        "네이티브_10편": xref_yes,
        "폴백_10편": xref_no,
        "map실패_10편": fail,
        "stdout": proc.stdout,
        "편별": per,
    }
    COST.write_text(json.dumps(cost, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {COST}")
    print(f"map {t_map:.1f}s · 추출 {t_ex:.1f}s · 10편 실측 × {n_pdf/10:.1f} = {t_ex * n_pdf / 10:.0f}s")
    print(f"디스크 {old_total/1048576:.2f}MB → {new_total/1048576:.2f}MB  ×{(new_total/old_total) if old_total else 0:.3f}")
    print(f"네이티브 {xref_yes} · 폴백 {xref_no}  (10편, 확장자 아님)")


if __name__ == "__main__":
    main()
