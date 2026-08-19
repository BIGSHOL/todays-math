# -*- coding: utf-8 -*-
"""완료본 HWP 를 **PDF 로 찍어낸다** (한글 COM). 토큰 0 · API 0.

    python scripts/figure/hwp-to-pdf.py            # 계획만
    python scripts/figure/hwp-to-pdf.py --write    # 실제 변환

입력: `scripts/qa/reports/hwp-topdf-rows.json`  (`편: [{e, hwp}]`)
출력: `.hwp-pdf/<examId>.pdf`   (저장소에 넣지 않는다)

## 왜 PDF 로 한 번 더 찍나 — **그림이 `<hp:pic>` 이 아닐 때가 있다**

`recover-hwp-figures.py` 는 HWPX 의 `<hp:pic>`(끼워 넣은 그림)만 꺼낸다. 그런데 한글은
도형을 **그리기 개체**(선·다각형·글상자의 묶음)로도 그린다. 그건 `<hp:pic>` 이 아니라
꺼낼 이미지 자체가 없다 — 실측으로 남은 기출 34행이 전부 이 부류다.

그리기 개체는 **인쇄하면 보인다.** 그래서 한글에게 PDF 로 찍게 하면 벡터로 나오고,
그 다음은 기출 PDF 와 똑같이 `crop-pdf-by-stem.py` 로 오려 낼 수 있다.

⚠️ 원본(N드라이브)은 **읽기만** 한다. 변환은 로컬 사본으로 하고, 원본 파일은 열지 않는다
   — 한글이 원본을 여는 순간 잠금·자동복구 파일이 생긴다.

⚠️ **편마다 하위 프로세스로 돌리고 시간제한을 건다.** 한글은 파일에 따라 대화상자를
   띄우고 COM 호출이 거기서 멈춘다 — 실측으로 한 편에서 20분을 붙잡혀 있었다.
   한 프로세스로 쭉 돌리면 그 한 편이 전체를 세운다. `SetMessageBoxMode` 로 대화상자를
   자동으로 넘기되, 그것으로도 안 되는 것은 시간제한이 끊는다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import sys
import time
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROWS = pathlib.Path("scripts/qa/reports/hwp-topdf-rows.json")
OUT = pathlib.Path(".hwp-pdf")


#: 한 편에 허용하는 시간(초). 넘으면 그 편은 포기하고 다음으로 간다.
PER_FILE_TIMEOUT = 90


def convert(app, src: pathlib.Path, dest: pathlib.Path, work: pathlib.Path) -> None:
    """원본을 건드리지 않도록 **사본**을 열어 PDF 로 저장한다."""
    local = work / re.sub(r"[^\w.\-]", "_", src.name)
    shutil.copy2(src, local)
    app.Open(str(local), "HWP", "forceopen:true")
    app.SaveAs(str(dest), "PDF")
    app.Clear(1)  # 저장 안 함
    local.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--one", nargs=2, metavar=("HWP", "DEST"),
                    help="한 편만 변환한다 (배치가 하위 프로세스로 부른다)")
    a = ap.parse_args()

    if a.one:
        import tempfile as _t
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        app = win32com.client.Dispatch("HWPFrame.HwpObject")
        try:
            app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:  # noqa: BLE001
            pass
        try:
            # 대화상자를 띄우지 않는다. 그래도 뜨는 것은 배치의 시간제한이 끊는다.
            app.SetMessageBoxMode(0x20000)
        except Exception:  # noqa: BLE001
            pass
        w = pathlib.Path(_t.mkdtemp(prefix="hwppdf1_"))
        try:
            convert(app, pathlib.Path(a.one[0]), pathlib.Path(a.one[1]), w)
        finally:
            try:
                app.Quit()
            except Exception:  # noqa: BLE001
                pass
            shutil.rmtree(w, ignore_errors=True)
        return

    plan = json.loads(ROWS.read_text(encoding="utf-8"))["편"]
    if a.limit:
        plan = plan[: a.limit]
    todo = [p for p in plan if not (OUT / f"{p['e']}.pdf").exists()]
    print(f"편 {len(plan)} · 이미 변환됨 {len(plan) - len(todo)} · 할 것 {len(todo)}")
    if not a.write:
        print("드라이런이다. 실제로 찍으려면 --write 를 붙여라.")
        return

    OUT.mkdir(exist_ok=True)
    import subprocess

    ok = fail = 0
    for i, p in enumerate(todo, 1):
        dest = (OUT / f"{p['e']}.pdf").resolve()
        try:
            subprocess.run(
                [sys.executable, __file__, "--one", p["hwp"], str(dest)],
                timeout=PER_FILE_TIMEOUT, capture_output=True,
            )
        except subprocess.TimeoutExpired:
            print(f"  ✗ {p['e']}: {PER_FILE_TIMEOUT}초 초과 — 포기")
            subprocess.run(["taskkill", "/F", "/IM", "Hwp.exe"], capture_output=True)
        if dest.exists() and dest.stat().st_size > 0:
            ok += 1
        else:
            fail += 1
            # 죽인 직후에는 한글이 아직 손잡이를 놓지 않았다. 몇 번 기다렸다 지운다.
            for _ in range(6):
                try:
                    dest.unlink(missing_ok=True)
                    break
                except PermissionError:
                    time.sleep(1)
        if i % 5 == 0:
            print(f"  {i}/{len(todo)} · 성공 {ok} 실패 {fail}", flush=True)
    print(f"── HWP → PDF ── 성공 {ok} · 실패 {fail} → {OUT}")


if __name__ == "__main__":
    main()
