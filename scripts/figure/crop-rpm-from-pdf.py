# -*- coding: utf-8 -*-
"""RPM 교재 PDF 에서 `source_coords` 좌표대로 문항 그림을 오려낸다. **LLM 토큰 0.**

계획: `scripts/qa/reports/rpm-crop-plan.json`
      (`npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts` 가 만든다)
산출: `public/figures/rpm/<externalId>/0.png`
      `scripts/qa/reports/rpm-crop-result.json`

사용: python scripts/figure/crop-rpm-from-pdf.py [--dpi 200] [--limit N]

## 좌표계

sumaek 의 `questions.source_coords` 는 `{"x0","y0","x1","y1","page"}` 이고
**PDF 포인트 좌표 · 좌상단 원점**이다(PyMuPDF 기본과 같다). 그래서 `fitz.Rect` 에
그대로 넣는다. `page` 는 1부터다 — PyMuPDF 인덱스는 0부터라 1을 뺀다.

## 지키는 것

- 원본 이미지를 그대로 뽑지 않고 **영역을 렌더**한다. 교재는 도형이 벡터로 그려져 있어
  xref 추출이 획 단위로 쪼개진다(실측: 기출 2065-4 가 15조각). 영역 렌더는 한 장이다.
- 좌표가 페이지 밖이거나 넓이가 0이면 **오려내지 않는다.** 엉뚱한 자리를 오리면
  그림 없음보다 나쁘다.
- 이미 있는 파일은 건너뛴다(멱등). 중단 후 다시 돌리면 이어 달린다.
- 실패는 결과 파일에 이유와 함께 남긴다 — 숫자만 줄어드는 침묵을 만들지 않는다.
"""
import argparse
import io
import json
import pathlib
import sys

import fitz

PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/rpm-crop-result.json")
# 원본이 대개 118dpi 라 200 이면 충분히 선명하고 파일도 작다(기출 추출기와 같은 값).
DEFAULT_DPI = 200
# 여백 — 좌표가 획에 딱 붙어 있으면 선이 잘려 보인다.
PAD = 2.0

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()

    if not PLAN.exists():
        raise SystemExit(
            f"계획이 없다: {PLAN}\n"
            "먼저 돌려라 — npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts"
        )
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    items = plan["목록"][: a.limit] if a.limit else plan["목록"]

    # 원본이 없으면 **그 사실을 먼저 말한다.** 0건 성공을 조용히 보고하지 않는다.
    missing_pdf = sorted(
        {i["pdf"] for i in items if not pathlib.Path(i["pdf"]).exists()}
    )
    if missing_pdf:
        print(f"⛔ 원본 PDF 가 없다 ({len(missing_pdf)}개):")
        for m in missing_pdf:
            print(f"   {m}")
        print("   → 문서 docs/planning/16-figure-recovery-ledger.md §4.1 참조")

    docs: dict[str, fitz.Document] = {}
    ok: list[dict] = []
    fail: list[dict] = []
    skipped = 0

    try:
        for it in items:
            out = pathlib.Path(it["out"])
            if out.exists() and out.stat().st_size > 0:
                skipped += 1
                ok.append(
                    {"problemId": it["problemId"], "publicPath": to_public(out)}
                )
                continue

            pdf = it["pdf"]
            if not pathlib.Path(pdf).exists():
                fail.append({"externalId": it["externalId"], "이유": "원본 PDF 없음"})
                continue
            if pdf not in docs:
                docs[pdf] = fitz.open(pdf)
            doc = docs[pdf]

            page_index = int(it["page"]) - 1
            if not (0 <= page_index < doc.page_count):
                fail.append(
                    {"externalId": it["externalId"], "이유": f"쪽 범위 밖 {it['page']}"}
                )
                continue
            page = doc[page_index]

            x0, y0, x1, y1 = (float(v) for v in it["rect"])
            rect = fitz.Rect(x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD) & page.rect
            if rect.is_empty or rect.width < 4 or rect.height < 4:
                fail.append(
                    {"externalId": it["externalId"], "이유": "좌표가 비었거나 너무 작다"}
                )
                continue

            out.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(clip=rect, dpi=a.dpi)
            pix.save(str(out))
            ok.append({"problemId": it["problemId"], "publicPath": to_public(out)})
    finally:
        for d in docs.values():
            d.close()

    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(
        json.dumps(
            {
                "대상": len(items),
                "성공수": len(ok),
                "이미있음": skipped,
                "실패수": len(fail),
                "실패": fail,
                "성공": ok,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f"── 오려내기 ── 대상 {len(items)} · 성공 {len(ok)}"
        f"(그중 이미있음 {skipped}) · 실패 {len(fail)}"
    )
    for reason in sorted({f['이유'] for f in fail}):
        n = sum(1 for f in fail if f["이유"] == reason)
        print(f"   실패:{reason} {n}")
    print(f"→ {RESULT}")
    if ok and not missing_pdf:
        print(
            "다음: ALLOW_SHARED_IMPORT=1 npx tsx "
            "scripts/qa/recover-rpm-figures-from-pdf.ts --attach"
        )


def to_public(out: pathlib.Path) -> str:
    """`public/figures/rpm/<id>/0.png` → `/figures/rpm/<id>/0.png`"""
    return "/" + out.as_posix().split("public/", 1)[1]


if __name__ == "__main__":
    main()
