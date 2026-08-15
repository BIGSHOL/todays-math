# -*- coding: utf-8 -*-
"""완료본 HWP/HWPX → 문항 단위 구조화 JSON (외부 API 0원, 결정론적)

완료본(3단계 사람검수본)에는 발문·수식·선택지에 더해 **사람이 채운 정답·[소단원]·[난이도]**
가 들어 있다. 비전 OCR 없이 HWPX XML 에서 그대로 뽑는다.

  python scripts/hwp_extract.py <입력.hwp|.hwpx> [-o 출력.json]
  python scripts/hwp_extract.py --batch <DB경로> --limit 50 --out <디렉터리>
"""
from __future__ import annotations
import argparse, json, os, re, sys, zipfile, shutil, tempfile, sqlite3, pathlib
import xml.etree.ElementTree as ET

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
_SKIP_CTRL = {HP + "header", HP + "footer"}      # 머리말·꼬리말은 본문이 아님
_META_RE = re.compile(r"\[(소단원|중단원)\]\s*([^\[\]]*?)(?=\s*\[|$)|\[난이도\]\s*([^\s\[\]]*)")
_SCORE_RE = re.compile(r"\[\s*\$?([\d.]+)\$?\s*점\s*\]")
# 라벨 번호는 수식 객체로 쪼개져 `[서술형 $1$]` 로 렌더된다(폼 규약) — $ 허용 필수.
_ESSAY_RE = re.compile(r"\[(서술형|서답형|단답형)\s*\$?(\d*)\$?\s*\]")


# ---------------------------------------------------------------- HWP → HWPX
def to_hwpx(src: pathlib.Path, workdir: pathlib.Path) -> pathlib.Path:
    """`.hwp` 는 HWP COM 으로 `.hwpx` 변환. `.hwpx` 는 그대로."""
    if src.suffix.lower() == ".hwpx":
        return src
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
    from core import hwp_com
    hwp_com.ensure_com_initialized()
    import win32com.client

    local = workdir / re.sub(r"[^\w.\-]", "_", src.name)
    shutil.copy2(src, local)
    out = local.with_suffix(".hwpx")
    app = win32com.client.Dispatch("HWPFrame.HwpObject")
    try:
        try:
            app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass
        if not app.Open(str(local.resolve()), "HWP", "forceopen:true"):
            raise RuntimeError("HWP Open 실패")
        app.SaveAs(str(out.resolve()), "HWPX", "")
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    if not out.exists():
        raise RuntimeError("HWPX 변환 실패")
    return out


# ---------------------------------------------------------------- XML 스트림
def _walk(node, out):
    """문서 순서대로 (kind, value). 머리말/꼬리말 subtree 는 건너뛴다."""
    for ch in node:
        if ch.tag in _SKIP_CTRL:
            continue
        if ch.tag == HP + "t":
            buf = ch.text or ""
            for g in ch:
                if g.tag == HP + "tab":
                    buf += " "
                buf += g.tail or ""
            if buf:
                out.append(("text", buf))
        elif ch.tag == HP + "script":
            out.append(("eq", (ch.text or "").strip()))
        elif ch.tag == HP + "endNote":
            # 미주 = 문항 앵커. 객관식은 정답 원문자, 서술형은 사람이 쓴 해설이 들어 있다.
            # 해설 안 수식(<hp:script>)까지 살려야 풀이가 온전하다.
            sub = []
            _walk(ch, sub)
            val = "".join(f"${v}$" if k == "eq" else v
                          for k, v in sub if k in ("text", "eq")).strip()
            out.append(("endnote", val))
        else:
            _walk(ch, out)
            if ch.tag == HP + "p":
                out.append(("br", ""))


def stream_of(hwpx: pathlib.Path):
    with zipfile.ZipFile(hwpx) as z:
        secs = sorted(n for n in z.namelist()
                      if re.match(r"Contents/section\d+\.xml", n))
        items = []
        for s in secs:
            root = ET.fromstring(z.read(s).decode("utf-8"))
            _walk(root, items)
    return items


# ---------------------------------------------------------------- 문항 분해
def _render(blocks) -> str:
    s = ""
    for k, v in blocks:
        if k == "text":
            s += v
        elif k == "eq":
            s += f"${v}$"
        elif k == "br":
            s += "\n"
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n{2,}", "\n", s).strip()


def _split_choices(body: str):
    """①~⑤ 선택지를 본문에서 분리."""
    idx = [(m.start(), m.group()) for m in re.finditer(f"[{CIRCLED}]", body)]
    if len(idx) < 4:
        return body, []
    # ① 부터 연속 증가하는 마지막 런을 선택지로 본다
    start = None
    for i, (pos, ch) in enumerate(idx):
        if ch == "①":
            seq, expect = [i], 1
            for j in range(i + 1, len(idx)):
                if idx[j][1] == CIRCLED[expect]:
                    seq.append(j); expect += 1
                    if expect >= 5:
                        break
            if len(seq) >= 4:
                start = idx[i][0]
                marks = [idx[k] for k in seq]
                break
    if start is None:
        return body, []
    stem = body[:start].strip()
    choices = []
    for n, (pos, ch) in enumerate(marks):
        end = marks[n + 1][0] if n + 1 < len(marks) else len(body)
        choices.append(body[pos + 1:end].strip())
    return stem, choices


def parse_exam(hwpx: pathlib.Path) -> dict:
    items = stream_of(hwpx)
    questions, cur = [], None
    for kind, val in items:
        if kind == "endnote":
            if cur:
                questions.append(cur)
            cur = {"answer_raw": val, "blocks": []}
        elif cur is not None:
            cur["blocks"].append((kind, val))
    if cur:
        questions.append(cur)

    out = []
    for i, q in enumerate(questions, 1):
        body = _render(q["blocks"])
        topic = diff = None
        for m in _META_RE.finditer(body):
            if m.group(2):
                topic = m.group(2).strip()
            if m.group(3):
                diff = m.group(3).strip()
        body = _META_RE.sub("", body).strip()

        score = None
        ms = _SCORE_RE.search(body)
        if ms:
            score = float(ms.group(1))
            body = _SCORE_RE.sub("", body).strip()

        label = None
        me = _ESSAY_RE.search(body)
        if me:
            label = me.group(0)

        # 미주 = 객관식이면 정답 원문자 한 글자, 서술형이면 사람이 쓴 풀이 전문.
        raw = (q["answer_raw"] or "").strip()
        raw = _ESSAY_RE.sub("", raw).strip()
        ans = sol = None
        # 미주 선두 원문자 = 객관식 정답. 뒤에 출처 메모("② 20년 11월 16번")가 붙기도 한다.
        mlead = re.match(rf"\s*([{CIRCLED}])(?!\s*[)．.])", raw)
        if mlead:
            ans = mlead.group(1)
            rest = raw[mlead.end():].strip()
            if len(rest) > 20:            # 메모가 아니라 실제 풀이면 해설로
                sol = rest
        elif len(raw) > 12:
            sol = raw
            m = re.match(r"정답\s*[:：]?\s*(.{1,40}?)(?:\s{2,}|$)", raw)
            if m:
                ans = m.group(1).strip()
        elif raw:
            ans = raw

        if ans and ans in CIRCLED:          # 본문에 중복 인쇄된 정답 원문자 제거
            body = re.sub(rf"^\s*{ans}\s*", "", body)
            body = re.sub(rf"\n\s*{ans}\s*(?=\n|$)", "\n", body, count=1)

        stem, choices = _split_choices(body)
        if len(choices) >= 4:
            qtype = "객관식"
        elif label and "서술" in label:
            qtype = "서술형"
        elif label:
            qtype = "단답형"
        else:
            qtype = "단답형" if sol or score else "기타"
        out.append({
            "number": i, "answer": ans, "solution": sol,
            "topic": topic, "difficulty": diff,
            "score": score, "label": label, "type": qtype,
            "stem": stem.strip(), "choices": choices,
        })
    return {"source": hwpx.name, "question_count": len(out), "questions": out}


# ---------------------------------------------------------------- 배치
def run_batch(db: str, limit: int, outdir: pathlib.Path, offset: int = 0):
    con = sqlite3.connect(db)
    rows = con.execute("""
      SELECT e.id, e.school, e.grade, e.subject, e.year, e.semester, e.round, f.path
      FROM exams e JOIN exam_files f ON f.exam_id = e.id
      WHERE f.ext IN ('.hwp','.hwpx')
        AND (f.status LIKE '%완료%' OR f.path LIKE '%워드%')
      GROUP BY e.id ORDER BY e.year DESC, e.id LIMIT ? OFFSET ?
    """, (limit, offset)).fetchall()
    con.close()
    outdir.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    stats = []
    work = pathlib.Path(tempfile.mkdtemp(prefix="hwpx_"))
    try:
        for eid, sch, gr, subj, yr, sem, rnd, path in rows:
            tag = f"[{sch}][{gr}][{subj}][{yr%100}-{sem}-{rnd}]"
            try:
                hx = to_hwpx(pathlib.Path(path), work)
                data = parse_exam(hx)
                data["meta"] = dict(exam_id=eid, school=sch, grade=gr, subject=subj,
                                    year=yr, semester=sem, round=rnd, src=path)
                qs = data["questions"]
                n_ans = sum(1 for q in qs if q["answer"])
                n_top = sum(1 for q in qs if q["topic"])
                (outdir / f"{eid}.json").write_text(
                    json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                ok += 1
                stats.append((len(qs), n_ans, n_top))
                print(f"  OK  {tag} 문항{len(qs):>3} 정답{n_ans:>3} 소단원{n_top:>3}", flush=True)
            except Exception as ex:
                fail += 1
                print(f"  FAIL {tag} :: {type(ex).__name__} {ex}", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n성공 {ok} / 실패 {fail}")
    if stats:
        tq = sum(s[0] for s in stats); ta = sum(s[1] for s in stats); tt = sum(s[2] for s in stats)
        print(f"총 문항 {tq}   정답 {ta} ({ta/max(1,tq)*100:.1f}%)   소단원 {tt} ({tt/max(1,tq)*100:.1f}%)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("-o", "--out")
    ap.add_argument("--batch")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--outdir", default="db/extracted")
    a = ap.parse_args()

    if a.batch:
        run_batch(a.batch, a.limit, pathlib.Path(a.outdir), a.offset)
        return
    if not a.src:
        ap.error("입력 파일 또는 --batch 필요")
    work = pathlib.Path(tempfile.mkdtemp(prefix="hwpx_"))
    try:
        hx = to_hwpx(pathlib.Path(a.src), work)
        data = parse_exam(hx)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    js = json.dumps(data, ensure_ascii=False, indent=1)
    if a.out:
        pathlib.Path(a.out).write_text(js, encoding="utf-8")
        print(f"saved: {a.out}  ({data['question_count']} questions)")
    else:
        print(js[:3000])


if __name__ == "__main__":
    main()
