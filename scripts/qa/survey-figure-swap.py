# -*- coding: utf-8 -*-
"""단계 2 조사 — 300dpi 재크롭본과 **지금 지면에 나가는 파일**을 맞대어 바꿔치기 계획을 만든다.

읽기만 한다. 아무것도 안 쓴다(계획 JSON 하나만 쓴다).

⚠️ 옛 파일은 **이 워크트리**(main 과 합쳐진 것)에서 본다. `그림화질` 워크트리의
   `public/figures` 로 재면 그 뒤 다른 세션이 회수해 붙인 그림을 못 본다 —
   실측 42장 차이가 있었다.
"""
import hashlib, json, pathlib, sys
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = pathlib.Path(__file__).resolve().parents[2]
OLD = HERE / "public/figures"
NEW = pathlib.Path(r"C:/Users/user/orca/workspaces/testautocreator/그림화질/public/figures-300")
OUT = HERE / "scripts/qa/reports/figure-swap-plan.json"
EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAXW = 264.567  # = 70mm @96dpi (printGeometry.JASEUP_MEASURED_PX.figureMaxWidth)


def md5(p: pathlib.Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def size_of(p):
    try:
        with Image.open(p) as im:
            return list(im.size)
    except Exception:
        return None


rows, stats = [], {
    "새 파일": 0, "옛 파일 없음": 0, "옛 후보 여럿": 0, "열지 못함": 0,
    "짝지음": 0, "가로가 늘어남": 0, "그대로/줄어듦": 0,
    "확장자가 달라짐": 0, "바이트가 같음": 0,
}

for p in sorted(NEW.rglob("*")):
    if p.suffix.lower() not in EXTS:
        continue
    stats["새 파일"] += 1
    rel = p.relative_to(NEW)
    d = OLD / rel.parent
    cands = sorted(d.glob(rel.stem + ".*")) if d.is_dir() else []
    cands = [c for c in cands if c.suffix.lower() in EXTS]
    if not cands:
        stats["옛 파일 없음"] += 1
        continue
    if len(cands) > 1:
        # 어느 것이 지면에 나가는지 파일만 보고 못 정한다 — 손대지 않는다.
        stats["옛 후보 여럿"] += 1
        rows.append({"new": str(rel).replace("\\", "/"), "verdict": "모호",
                     "why": f"옛 후보 {len(cands)}개: " + ", ".join(c.name for c in cands)})
        continue
    q = cands[0]
    ns, os_ = size_of(p), size_of(q)
    if ns is None or os_ is None:
        stats["열지 못함"] += 1
        rows.append({"new": str(rel).replace("\\", "/"), "verdict": "열지못함"})
        continue
    stats["짝지음"] += 1
    grew = ns[0] > os_[0]
    stats["가로가 늘어남" if grew else "그대로/줄어듦"] += 1
    ext_changed = q.suffix.lower() != p.suffix.lower()
    if grew and ext_changed:
        stats["확장자가 달라짐"] += 1
    same_bytes = q.stat().st_size == p.stat().st_size and md5(q) == md5(p)
    if same_bytes:
        stats["바이트가 같음"] += 1
    rows.append({
        "url": "/figures/" + str(q.relative_to(OLD)).replace("\\", "/"),
        "old": str(q.relative_to(OLD)).replace("\\", "/"),
        "new": str(rel).replace("\\", "/"),
        "oldPx": os_, "newPx": ns,
        "oldBytes": q.stat().st_size, "newBytes": p.stat().st_size,
        "oldExt": q.suffix.lower(), "newExt": p.suffix.lower(),
        "extChanged": ext_changed,
        "sameBytes": same_bytes,
        "verdict": "바꾼다" if grew else "안바꾼다",
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "기준": "새 파일 가로 > 옛 파일 가로 인 것만 바꾼다. 옛 파일은 이 워크트리 public/figures.",
    "만든이": "scripts/qa/survey-figure-swap.py",
    "옛경로": str(OLD), "새경로": str(NEW),
    "집계": stats, "행": rows,
}, ensure_ascii=False, indent=1), encoding="utf-8")

for k, v in stats.items():
    print(f"  {k:16} {v:6,}")
swap = [r for r in rows if r.get("verdict") == "바꾼다"]
print(f"\n바꿀 것 {len(swap):,}장")
if swap:
    ob = sum(r["oldBytes"] for r in swap); nb = sum(r["newBytes"] for r in swap)
    print(f"  용량 {ob/1048576:.1f}MB → {nb/1048576:.1f}MB  (+{(nb-ob)/1048576:.1f}MB)")
    lo = sum(1 for r in swap if (r["oldPx"][0] / (MAXW/96.0) if r["oldPx"][0] >= MAXW else 96.0) < 150)
    ln = sum(1 for r in swap if (r["newPx"][0] / (MAXW/96.0) if r["newPx"][0] >= MAXW else 96.0) < 150)
    print(f"  이 무리의 150dpi 미만: 지금 {lo:,} → 바꾸면 {ln:,}")
print(f"기록 → {OUT}")
