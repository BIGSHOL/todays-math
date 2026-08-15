# -*- coding: utf-8 -*-
"""트랙 A 인계 전 `.hwpx` 전수 검증.

트랙 A 는 이 파일들을 믿고 그림을 뽑는다. COM 변환이 중간에 끊기거나 병렬 경합으로
반만 써진 파일이 섞이면 **그림이 조용히 빠진다** — 에러가 아니라 숫자만 줄어든다.
그래서 넘기기 전에 전부 열어 본다. ZIP 이라 COM 없이 가능하고 몇 분이면 끝난다.

확인하는 것: ZIP 으로 열리는가 · `Contents/section0.xml` 이 있는가 · `BinData/` 가
몇 장이고 압축 전/후 크기가 얼마인가(트랙 A 가 디스크를 가늠할 수 있게).

  python scripts/qa/verify-hwpx.py
"""
import collections
import json
import pathlib
import sys
import zipfile

KEEP = pathlib.Path("scripts/qa/reports/hwpx")
OUT = pathlib.Path("scripts/qa/reports/hwpx-manifest.json")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    files = sorted(KEEP.glob("*.hwpx"))
    ok = bad = 0
    no_section = 0
    imgs = 0
    raw = comp = 0
    with_img = 0
    ext = collections.Counter()
    broken: list[str] = []
    manifest: dict[str, dict] = {}

    for f in files:
        try:
            with zipfile.ZipFile(f) as z:
                names = z.namelist()
                if not any(n.startswith("Contents/section") for n in names):
                    no_section += 1
                    broken.append(f"{f.stem}: section 없음")
                    bad += 1
                    continue
                n_img = 0
                r = c = 0
                for i in z.infolist():
                    if not i.filename.startswith("BinData/"):
                        continue
                    n_img += 1
                    r += i.file_size
                    c += i.compress_size
                    ext[pathlib.PurePath(i.filename).suffix.lower()] += 1
        except Exception as exc:  # noqa: BLE001
            bad += 1
            broken.append(f"{f.stem}: {type(exc).__name__} {exc}"[:120])
            continue
        ok += 1
        imgs += n_img
        raw += r
        comp += c
        if n_img:
            with_img += 1
        manifest[f.stem] = {"images": n_img, "rawBytes": r, "zipBytes": c}

    OUT.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print("── `.hwpx` 전수 검증 (트랙 A 인계용) ──")
    print(f"파일 {len(files)}편 · 정상 {ok} · 손상 {bad} (그중 section 없음 {no_section})")
    print(f"그림 보유 편 {with_img} · BinData {imgs}장")
    print(f"압축 전 {raw/1e9:.1f}GB → ZIP 안에서 {comp/1e9:.1f}GB "
          f"(풀면 {raw/1e9:.1f}GB 가 필요하다 — 안 풀면 그 비용은 안 든다)")
    print("확장자:", dict(ext.most_common(6)))
    for b in broken[:10]:
        print("  ! " + b)
    print("→", OUT)


if __name__ == "__main__":
    main()
