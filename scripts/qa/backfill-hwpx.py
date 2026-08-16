# -*- coding: utf-8 -*-
"""이미 문항 JSON 은 뽑았는데 `.hwpx` 를 안 남긴 편만 골라 **변환만** 다시 한다.

D-1 은 처음에 `.hwpx` 를 임시 폴더에 만들고 지웠다(벤더링 `hwp_extract.py` 기본 동작).
트랙 A 가 그림을 HWPX `BinData` 에서 읽어야 한다는 요청이 도중에 와서
`hwp_extract_keep.py` 로 바꿨지만, 그 전에 끝난 편은 `.hwpx` 가 없다.

이 스크립트는 **문항 재추출을 하지 않는다** — `to_hwpx` 만 부르고 끝낸다.
JSON 은 이미 있으므로 파싱을 다시 할 이유가 없다.

  python scripts/qa/backfill-hwpx.py --limit 1000 [--offset N]

재개 가능하다(이미 있는 `.hwpx` 는 건너뛴다). 본 추출이 끝난 **뒤에** 돌릴 것 —
한컴 COM 은 단일 인스턴스라 같이 돌리면 서로 느려진다.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.append(str(pathlib.Path(__file__).parent))

OUT_JSON = pathlib.Path("scripts/qa/reports/hwp")
KEEP = pathlib.Path("scripts/qa/reports/hwpx")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_queue() -> list[dict]:
    src = open("scripts/qa/extract-hwp-all.py", encoding="utf-8").read().split("def main()")[0]
    src = src.replace("sys.path.append(str(pathlib.Path(__file__).parent))", "")
    ns: dict = {"__file__": "scripts/qa/extract-hwp-all.py"}
    exec(src, ns)  # noqa: S102 — 같은 저장소의 우리 코드다
    return ns["build_queue"]()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--tag", default="")
    a = ap.parse_args()

    KEEP.mkdir(parents=True, exist_ok=True)
    queue = load_queue()
    need = [
        p
        for p in queue
        if (OUT_JSON / f"{p['examId']}.json").exists()
        and not (KEEP / f"{p['examId']}.hwpx").exists()
    ]
    tag = f"[{a.tag}] " if a.tag else ""
    print(f"{tag}JSON 은 있고 .hwpx 는 없는 편 {len(need)}")
    todo = need[a.offset : a.offset + a.limit]

    script = pathlib.Path("scripts/qa/_hwpx_only.py").resolve()
    script.write_text(
        "\n".join(
            [
                "# -*- coding: utf-8 -*-",
                "import pathlib, shutil, sys, tempfile",
                "sys.path.insert(0, str(pathlib.Path('scripts/vendor/testchanger').resolve()))",
                "from hwp_extract import to_hwpx",
                "src, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])",
                "if src.suffix.lower() == '.hwpx':",
                "    shutil.copy2(src, target)",
                "else:",
                "    w = pathlib.Path(tempfile.mkdtemp(prefix='hxo_'))",
                "    try:",
                "        shutil.move(str(to_hwpx(src, w)), str(target))",
                "    finally:",
                "        shutil.rmtree(w, ignore_errors=True)",
            ]
        ),
        encoding="utf-8",
    )

    ok = fail = 0
    t0 = time.time()
    for i, p in enumerate(todo, 1):
        eid = str(p["examId"])
        target = KEEP / f"{eid}.hwpx"
        if target.exists():
            continue
        if not pathlib.Path("N:\\").exists():
            print(f"{tag}N드라이브 끊김 — 중단. 연결 후 재실행하면 이어 달린다.")
            break
        try:
            subprocess.run(
                [sys.executable, str(script), p["hwp"], str(target)],
                capture_output=True,
                timeout=a.timeout,
                check=True,
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            print(f"{tag}FAIL {eid} :: {type(exc).__name__} {str(exc)[:90]}", flush=True)
        if ok and ok % 25 == 0:
            el = time.time() - t0
            print(f"{tag}진행 {i}/{len(todo)} · 성공 {ok} 실패 {fail} · {el:.0f}s ({el/ok:.1f}s/편)", flush=True)

    total_mb = sum(f.stat().st_size for f in KEEP.glob("*.hwpx")) / 1e6
    print(f"{tag}완료 — 성공 {ok} · 실패 {fail} · {time.time()-t0:.0f}s")
    print(f"{tag}.hwpx {len(list(KEEP.glob('*.hwpx')))}편 · {total_mb:.0f}MB → {KEEP}")
    shutil.rmtree(script, ignore_errors=True) if script.is_dir() else None


if __name__ == "__main__":
    main()
