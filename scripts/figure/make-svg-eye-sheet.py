# -*- coding: utf-8 -*-
"""SVG 전량 결과에서 **눈으로 볼 대조표**를 만든다.

겹쳐 대조 숫자가 초록이어도 세 번 눈이 멀었다(℃↔¾, 획손실 번짐, <use> 굵기).
그래서 「문제 없음」을 **가장 의심스러운 순서로** 나란히 놓는다.

  python scripts/figure/make-svg-eye-sheet.py

산출: `.work/svg-eye/` 아래 PNG 여러 장 + 목록 JSON.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageChops

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORTS = ROOT / "scripts" / "qa" / "reports"
RESULT = REPORTS / "figure-vector-svg-result.json"
FIG = ROOT / "public" / "figures"
SVG = ROOT / "public" / "figures-svg"
OUT = ROOT / ".work" / "svg-eye"
SHOTS = ROOT / "scripts" / "figure" / "render-svg-shots.mjs"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def pick(rows):
    ok = [r for r in rows if r.get("ok")]
    bad = [r for r in rows if not r.get("ok")]
    ok_by_diff = sorted(ok, key=lambda r: r.get("diff") or 0)
    ok_by_loss = sorted(ok, key=lambda r: r.get("lost_ink") or 0)
    rpm = [r for r in ok if r["figure"].startswith("rpm/")]
    exam = [r for r in ok if not r["figure"].startswith("rpm/")]

    def take(xs, n, step_from_end=False):
        if not xs:
            return []
        if step_from_end:
            return xs[-n:]
        # 고루: 앞(가장 의심=차이 최소)·중간·끝
        if len(xs) <= n:
            return xs
        out = []
        for i in range(n):
            out.append(xs[int(i * (len(xs) - 1) / max(1, n - 1))])
        return out

    groups = {
        "통과_차이최소(가장 의심)": ok_by_diff[:12],
        "통과_차이최대": ok_by_diff[-8:],
        "통과_획손실최대": ok_by_loss[-8:],
        "통과_RPM_고루": take(rpm, 10),
        "통과_기출_고루": take(exam, 10),
        "버림_차이최소(아슬)": sorted(bad, key=lambda r: r.get("diff") or 9)[:8],
        "버림_획손실최대": sorted(bad, key=lambda r: r.get("lost_ink") or 0)[-8:],
    }
    return groups


def render_svgs(paths_wh):
    """[{svg, png, w, h}, ...] Chromium 으로 그린다."""
    if not paths_wh:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    jf = OUT / "jobs.json"
    jf.write_text(json.dumps(paths_wh), encoding="utf-8")
    cmd = [("npx.cmd" if sys.platform == "win32" else "npx"),
           "node", str(SHOTS), str(jf)]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                         errors="replace", cwd=str(ROOT))
    if out.returncode != 0:
        out = subprocess.run(["node", str(SHOTS), str(jf)],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", cwd=str(ROOT))
    if out.returncode != 0:
        raise SystemExit("Chromium 렌더 실패:\n" + (out.stderr or "")[-2000:])


def sheet(title, rows, dest):
    CW, CH = 340, 250
    cells = []
    jobs = []
    for r in rows:
        disk = FIG / r["figure"]
        svg = SVG / (r["figure"].rsplit(".", 1)[0] + ".svg")
        if not disk.exists():
            continue
        with Image.open(disk) as im:
            w, h = im.size
        png = OUT / ("m_" + r["figure"].replace("/", "_") + ".png")
        if svg.exists():
            jobs.append({"svg": str(svg.resolve()), "png": str(png.resolve()),
                         "w": w, "h": h, "figure": r["figure"]})
        cells.append((r, disk, png if svg.exists() else None))
    render_svgs([{"svg": j["svg"], "png": j["png"], "w": j["w"], "h": j["h"]}
                 for j in jobs])

    if not cells:
        return 0
    sh = Image.new("RGB", (CW * 2 + 28, CH * len(cells) + 28), (255, 255, 255))
    dr = ImageDraw.Draw(sh)
    dr.text((8, 4), title, fill=(0, 0, 0))
    y = 22
    for r, disk, mp in cells:
        o = Image.open(disk).convert("RGB")
        if mp is not None and mp.exists():
            m = Image.open(mp).convert("RGB")
        else:
            m = Image.new("RGB", o.size, (230, 230, 230))
        label = "%s  diff=%s  lost=%s  %s" % (
            r["figure"][:42], r.get("diff"), r.get("lost_ink"),
            "통과" if r.get("ok") else "버림")
        dr.text((8, y), label, fill=(0, 0, 0))
        for j, im in enumerate((o, m)):
            c = im.copy()
            c.thumbnail((CW - 12, CH - 28))
            sh.paste(c, (j * CW + 10, y + 14))
        y += CH
    dest.parent.mkdir(parents=True, exist_ok=True)
    sh.save(dest)
    return len(cells)


def main():
    if not RESULT.exists():
        raise SystemExit("결과가 없다: %s" % RESULT)
    data = json.loads(RESULT.read_text(encoding="utf-8"))
    rows = data["행"]
    groups = pick(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    summary = {"집계": data.get("집계"), "문턱": data.get("문턱"), "표": {}}
    for name, rs in groups.items():
        # 중복 제거
        seen = set()
        uniq = []
        for r in rs:
            if r["figure"] in seen:
                continue
            seen.add(r["figure"])
            uniq.append(r)
        dest = OUT / (name + ".png")
        n = sheet(name, uniq, dest)
        summary["표"][name] = {
            "장": n,
            "파일": str(dest),
            "목록": [{"figure": r["figure"], "diff": r.get("diff"),
                     "lost_ink": r.get("lost_ink"), "ok": r.get("ok")}
                    for r in uniq],
        }
        print("%s %d장 → %s" % (name, n, dest))
    (OUT / "index.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("→", OUT / "index.json")


if __name__ == "__main__":
    main()
