# -*- coding: utf-8 -*-
"""㉮ 비용 5항목 — 재크롭 전에 분모·원본 존재·경로를 먼저 센다.

추정치를 사실처럼 쓰지 않는다. 못 잰 것은 못 잰다고 찍는다.
읽기만. 공유 DB 에 쓰지 않는다. public/figures 를 덮지 않는다.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / "public" / "figures"
MANIFEST = ROOT / "scripts" / "figure" / "figure-manifest.json"
IDX = Path(r"F:\시험지변환기\db\exam_index.db")
PAGES = Path(r"F:\시험지변환기\db\pages")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def list_figures() -> list[Path]:
    out = []
    for p in FIG.rglob("*"):
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            out.append(p)
    return out


def main() -> None:
    figs = list_figures()
    groups: Counter[str] = Counter()
    bytes_total = 0
    for p in figs:
        groups[p.relative_to(FIG).parts[0]] += 1
        bytes_total += p.stat().st_size
    exam_ids = sorted(k for k in groups if k.isdigit())
    rpm_n = groups.get("rpm", 0)
    exam_n = sum(groups[k] for k in exam_ids)
    print("=== 디스크 그림 ===")
    print(f"장수 {len(figs)} · 용량 {bytes_total / 1048576:.1f} MB")
    print(f"기출 편 {len(exam_ids)} · 기출 장 {exam_n} · RPM 장 {rpm_n}")
    print(f"그 외 그룹 {[k for k in groups if k not in exam_ids and k != 'rpm']}")

    manifest = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    man_exams = set(manifest)
    man_files = 0
    for qmap in manifest.values():
        for paths in qmap.values():
            man_files += len(paths)
    print("\n=== figure-manifest ===")
    print(f"편 {len(man_exams)} · 경로 {man_files}")
    print(f"디스크 기출편 중 대장에 있음 {sum(1 for e in exam_ids if e in man_exams)}")
    print(f"디스크 기출편 중 대장에 없음 {sum(1 for e in exam_ids if e not in man_exams)}")

    print("\n=== exam_index / 원본 PDF ===")
    print(f"exam_index 존재 {IDX.exists()}  {IDX}")
    print(f"pages 캐시 존재 {PAGES.exists()}  {PAGES}")
    if not IDX.exists():
        print("못 잰다: exam_index.db 가 없다")
        return

    con = sqlite3.connect(str(IDX))
    cols = [r[1] for r in con.execute("pragma table_info(exams)")]
    print(f"exams 컬럼 {cols}")
    n_exams = con.execute("select count(*) from exams").fetchone()[0]
    n_q = con.execute("select count(*) from questions").fetchone()[0]
    print(f"exams {n_exams} · questions {n_q}")

    # src_path 존재
    exist = missing = empty = 0
    missing_samples = []
    exist_samples = []
    src_of: dict[str, str] = {}
    for eid, src in con.execute("select id, src_path from exams"):
        key = str(eid)
        src_of[key] = src or ""
        if not src:
            empty += 1
            continue
        p = Path(src)
        if p.exists():
            exist += 1
            if len(exist_samples) < 3:
                exist_samples.append((key, src))
        else:
            missing += 1
            if len(missing_samples) < 5:
                missing_samples.append((key, src))
    print(f"src_path 디스크에 있음 {exist} · 없음 {missing} · 비어있음 {empty}")
    for k, s in exist_samples:
        print(f"  있음 예 {k} {s}")
    for k, s in missing_samples:
        print(f"  없음 예 {k} {s}")

    # 그림이 있는 편만
    have_src = no_src = src_missing = src_ok = 0
    figs_ok = figs_missing = figs_no_src = 0
    cache_ok = cache_missing = 0
    for eid in exam_ids:
        src = src_of.get(eid, "")
        nfig = groups[eid]
        cache = PAGES / eid / "src.pdf"
        if cache.exists():
            cache_ok += 1
        else:
            cache_missing += 1
        if not src:
            no_src += 1
            figs_no_src += nfig
            continue
        have_src += 1
        if Path(src).exists():
            src_ok += 1
            figs_ok += nfig
        else:
            src_missing += 1
            figs_missing += nfig
    print("\n=== 디스크 그림 편 × 원본 ===")
    print(f"그림 있는 기출 편 {len(exam_ids)}")
    print(f"  exam_index 에 src_path 있음 {have_src} · 없음 {no_src}")
    print(f"  src_path 파일이 디스크에 있음 {src_ok}편 / 그림 {figs_ok}장")
    print(f"  src_path 가 적혀 있으나 파일 없음 {src_missing}편 / 그림 {figs_missing}장")
    print(f"  src_path 자체가 없음 {no_src}편 / 그림 {figs_no_src}장")
    print(f"  pages/<id>/src.pdf 캐시 있음 {cache_ok} · 없음 {cache_missing}")

    # src_path 확장자
    ext_c: Counter[str] = Counter()
    for eid in exam_ids:
        src = src_of.get(eid, "")
        if not src:
            ext_c["(없음)"] += 1
        else:
            ext_c[Path(src).suffix.lower() or "(확장자없음)"] += 1
    print(f"  src_path 확장자 {dict(ext_c)}")

    # 대장에 없는 312편 — 파일 이름 모양
    print("\n=== 대장에 없는 기출 편 ===")
    name_kind: Counter[str] = Counter()
    not_in_man = [e for e in exam_ids if e not in man_exams]
    for eid in not_in_man:
        for p in (FIG / eid).iterdir():
            if not p.is_file():
                continue
            n = p.name.lower()
            if n.startswith("hwp-"):
                name_kind["hwp-*"] += 1
            elif n.startswith("q") and p.suffix.lower() in {".png", ".jpg", ".jpeg"}:
                name_kind["qNN"] += 1
            else:
                name_kind[n] += 1
    print(f"편 {len(not_in_man)} · 파일 이름 {dict(name_kind)}")
    print(f"그 편 src 확장자 {Counter(Path(src_of[e]).suffix.lower() for e in not_in_man)}")

    # 대장에 있는 편의 src 확장자
    in_man = [e for e in exam_ids if e in man_exams]
    print(f"대장 있는 편 src 확장자 {Counter(Path(src_of[e]).suffix.lower() for e in in_man)}")

    # RPM 원본
    print("\n=== RPM 원본 ===")
    rpm_cands = [
        Path(".rpm-src"),
        Path(r"N:\개인\강아\교재자료\RPM"),
        Path(r"N:\개인\강아\교재자료\RPM\15"),
    ]
    for d in rpm_cands:
        print(f"  {d} exists={d.exists()}")
        if d.exists() and d.is_dir():
            pdfs = list(d.rglob("*.pdf"))
            print(f"    pdf {len(pdfs)}")
            for p in pdfs[:12]:
                print(f"    {p}  {p.stat().st_size/1048576:.1f}MB")


if __name__ == "__main__":
    main()
