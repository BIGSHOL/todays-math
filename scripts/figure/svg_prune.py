# -*- coding: utf-8 -*-
"""MuPDF 가 낸 쪽 SVG 에서 **칸 밖의 것을 쳐낸다.**

## 왜 글자를 다시 조판하지 않고 이 길을 가나 (실측 2026-08-19)

처음엔 `get_drawings()` 로 획을 옮기고 글자는 `<text>` 로 다시 조판했다. 그림은
잘 나왔는데 **글자가 통째로 틀렸다**:

- RPM 교재: `℃` 가 `¾` 로, 분수 `1/2` 가 엉뚱한 글자로 나온다. `EHsang`·`EHboNA`
  같은 **자체 인코딩 수식 글꼴**이라 텍스트 레이어의 코드포인트가 뜻과 다르다
  (CLAUDE.md 2026-08-19 「한 글자가 네 뜻이었다」와 같은 자리).
- 기출: `HyhwpEQ` 가 PUA(`` …)를 쓴다. 표본 60건 중 **58건**이 그렇다.

그리고 **이 오류는 겹쳐 대조에 안 걸린다** — `℃` 와 `¾` 는 픽셀 차이가 작아서
평균 절대차 0.027 로 **통과**했다. 「틀린 숫자는 아무 말도 안 한다」(CLAUDE.md).

그래서 글자는 **다시 쓰지 않고 윤곽선 그대로** 옮긴다. MuPDF 의
`get_svg_image(text_as_path=True)` 가 글리프를 `<defs>` 의 path 로 내주므로
인코딩이 무엇이든 **보이는 모양 그대로**다.

## 그 대신 쪽 전체가 딸려 온다 (브리프 §2 가 경고한 것)

실측: 한 그림에 443KB · path 414 · use 954. 칸으로 잘라도 MuPDF 는 쪽 내용을
전부 적고 `clipPath` 로 가릴 뿐이다. 그래서 여기서 **좌표로 쳐낸다**:

1. 그릴 수 있는 요소(`path`·`use`·`image`)의 bbox 를 실제로 계산한다.
   `d` 는 명령을 제대로 훑는다 — 숫자만 짝지어 읽으면 `H`/`V` 에서 x·y 가 뒤바뀐다.
2. viewBox 밖이면 버린다. **애매하면 남긴다**(bbox 를 넉넉히 잡는다) —
   잘못 지운 획은 지면에서 티가 안 난다.
3. 남은 것이 참조하는 `<defs>` 만 남긴다(글리프 정의가 용량의 절반이다).
"""
import re

_NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
_CMD = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)")
_ELEM = re.compile(r"<(path|use|image|g|/g|defs|/defs|symbol|/symbol|clipPath|/clipPath)\b")


def _nums(s):
    return [float(x) for x in _NUM.findall(s)]


def path_bbox(d):
    """`d` 의 대략 bbox — **넉넉한 쪽으로** 잡는다(베지에 제어점을 그대로 센다)."""
    x = y = 0.0
    sx = sy = 0.0
    pts = []
    for cmd, arg in _CMD.findall(d):
        v = _nums(arg)
        up = cmd.isupper()
        c = cmd.upper()
        if c == "Z":
            x, y = sx, sy
            continue
        i = 0
        if c == "M" or c == "L" or c == "T":
            step = 2
        elif c == "H" or c == "V":
            step = 1
        elif c == "C":
            step = 6
        elif c == "S" or c == "Q":
            step = 4
        elif c == "A":
            step = 7
        else:
            continue
        first = True
        while i + step <= len(v):
            seg = v[i:i + step]
            i += step
            if c == "H":
                x = seg[0] if up else x + seg[0]
                pts.append((x, y))
            elif c == "V":
                y = seg[0] if up else y + seg[0]
                pts.append((x, y))
            elif c == "A":
                nx, ny = (seg[5], seg[6]) if up else (x + seg[5], y + seg[6])
                # 호는 끝점만으로는 모자란다 — 반지름만큼 넉넉히 잡는다.
                rx, ry = abs(seg[0]), abs(seg[1])
                pts += [(min(x, nx) - rx, min(y, ny) - ry), (max(x, nx) + rx, max(y, ny) + ry)]
                x, y = nx, ny
            else:
                for k in range(0, step, 2):
                    px, py = seg[k], seg[k + 1]
                    if not up:
                        px, py = x + px, y + py
                    pts.append((px, py))
                nx, ny = seg[step - 2], seg[step - 1]
                if not up:
                    nx, ny = x + nx, y + ny
                x, y = nx, ny
            if c == "M" and first:
                sx, sy = x, y
            first = False
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def parse_matrix(t):
    """`transform="matrix(a,b,c,d,e,f)"` / `translate(..)` / `scale(..)` → 6-튜플."""
    if not t:
        return (1, 0, 0, 1, 0, 0)
    m = re.search(r"matrix\(([^)]*)\)", t)
    if m:
        v = _nums(m.group(1))
        if len(v) >= 6:
            return tuple(v[:6])
    a, b, c, d, e, f = 1, 0, 0, 1, 0, 0
    m = re.search(r"translate\(([^)]*)\)", t)
    if m:
        v = _nums(m.group(1))
        e, f = v[0], (v[1] if len(v) > 1 else 0.0)
    m = re.search(r"scale\(([^)]*)\)", t)
    if m:
        v = _nums(m.group(1))
        a = v[0]
        d = v[1] if len(v) > 1 else v[0]
    return (a, b, c, d, e, f)


def apply_m(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def bbox_through(m, bb):
    x0, y0, x1, y1 = bb
    pts = [apply_m(m, x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def intersects(bb, w, h, pad):
    return not (bb[2] < -pad or bb[0] > w + pad or bb[3] < -pad or bb[1] > h + pad)


def fix_use_stroke_width(body):
    """`<use>` 의 `stroke-width` 를 **글리프 변환 배율로 나눈다.**

    ## 왜 (실측 2026-08-19 · 눈으로 찾았다)

    HWP 는 「〈 조 건 〉」 같은 머리글을 **글자를 칠하지 않고 윤곽만 얇게 긋는**
    방식(PDF 텍스트 렌더 모드 stroke)으로 그린다. MuPDF 는 그것을

        <use href="#font_9_86" stroke-width=".1668" transform="matrix(9,0,0,-9,…)"/>

    로 적는데, SVG 에서 `<use>` 의 `stroke-width` 는 **참조된 내용의 좌표계**에서
    해석되므로 그 변환(9배)에 **같이 곱해진다.** 즉 0.1668pt 로 그으려던 것이
    1.5pt 가 되어 **글자가 통째로 굵어진다.**

    ⚠️ **겹쳐 대조로는 이걸 못 잡았다** — 글자가 굵어져도 평균 절대차는 조금만
    움직인다. 표본을 400dpi 로 확대해 눈으로 보고서야 드러났다.

    그래서 배율(변환 행렬식의 제곱근)로 나눠 원래 물리 굵기로 되돌린다.
    """
    def one(m):
        tag = m.group(0)
        sw = re.search(r'stroke-width="([-\d.eE]+)"', tag)
        tr = re.search(r'transform="matrix\(([^)]*)\)"', tag)
        if not sw or not tr:
            return tag
        v = _nums(tr.group(1))
        if len(v) < 6:
            return tag
        det = abs(v[0] * v[3] - v[1] * v[2])
        if det <= 0:
            return tag
        sc = det ** 0.5
        try:
            w0 = float(sw.group(1))
        except ValueError:
            return tag
        return tag.replace(sw.group(0), 'stroke-width="%.6g"' % (w0 / sc))

    return re.sub(r"<use\b[^>]*/>", one, body)


def prune(svg, w, h, pad=2.0, glyph_span=1.6):
    """칸(0,0,w,h) 밖의 그릴 요소를 쳐내고, 남은 것이 쓰는 defs 만 남긴다.

    `glyph_span` — `<use>` 는 글리프 원점만 알려 준다. 글리프는 원점 둘레로
    대략 [-0.3, 1.3] 범위를 차지하므로 그만큼 넉넉히 잡는다(넉넉한 쪽이 안전).
    """
    head_end = svg.index(">", svg.index("<svg")) + 1
    head = svg[:head_end]
    rest = svg[head_end:]
    dend = rest.find("</defs>")
    defs = rest[: dend + len("</defs>")] if dend >= 0 else ""
    body = rest[dend + len("</defs>"):] if dend >= 0 else rest

    kept, dropped = [], 0
    used_ids = set()

    def keep_tag(tag):
        nonlocal dropped
        t = re.search(r'transform="([^"]*)"', tag)
        m = parse_matrix(t.group(1) if t else None)
        if tag.startswith("<use"):
            bb = bbox_through(m, (-0.3, -0.3, glyph_span, glyph_span))
        elif tag.startswith("<image"):
            x = float((re.search(r'\bx="([-\d.]+)"', tag) or [0, "0"])[1])
            y = float((re.search(r'\by="([-\d.]+)"', tag) or [0, "0"])[1])
            iw = float((re.search(r'\bwidth="([-\d.]+)"', tag) or [0, "1"])[1])
            ih = float((re.search(r'\bheight="([-\d.]+)"', tag) or [0, "1"])[1])
            bb = bbox_through(m, (x, y, x + iw, y + ih))
            # ⚠️ **칸을 덮는 이미지는 쪽 배경이다.** RPM 교재는 쪽마다 배경 PNG 를
            #    한 장 깔아 두는데, 그게 실은 **거의 전부 0인(=검은) 704×1123 PNG**
            #    라 그대로 남기면 그림이 **온통 검게** 나온다(실측: 획만 그리면
            #    정상, 이미지 한 장을 얹으면 극값이 (0,0)). 원장의 `kind` 판정이
            #    이미 「덮는 이미지는 세지 않는다」로 갈라 놓은 것과 같은 기준이고,
            #    여기 들어오는 것은 애초에 `kind == vector` 인 칸뿐이라
            #    **칸을 덮는 이미지는 그림일 수 없다.**
            area = max(0.0, min(bb[2], w) - max(bb[0], 0)) * max(0.0, min(bb[3], h) - max(bb[1], 0))
            if area >= w * h * 0.7:
                dropped += 1
                return False
        else:
            dm = re.search(r'\sd="([^"]*)"', tag)
            if not dm:
                return True
            b = path_bbox(dm.group(1))
            if b is None:
                return True
            bb = bbox_through(m, b)
        if intersects(bb, w, h, pad):
            return True
        dropped += 1
        return False

    for chunk in re.split(r"(<(?:path|use|image)\b[^>]*/>)", body):
        if chunk.startswith("<path") or chunk.startswith("<use") or chunk.startswith("<image"):
            if not keep_tag(chunk):
                continue
            for m in re.finditer(r'(?:xlink:)?href="#([^"]+)"', chunk):
                used_ids.add(m.group(1))
            for m in re.finditer(r'url\(#([^)]+)\)', chunk):
                used_ids.add(m.group(1))
        kept.append(chunk)
    body = "".join(kept)
    for m in re.finditer(r'url\(#([^)]+)\)', body):
        used_ids.add(m.group(1))

    # ── defs 솎기 ────────────────────────────────────────────────────────
    # 참조가 참조를 부를 수 있으니 더 안 늘 때까지 돈다.
    blocks = re.findall(r"<(symbol|clipPath|g|path)\b[^>]*\bid=\"([^\"]+)\"[^>]*(?:/>|>.*?</\1>)",
                        defs, flags=re.S)
    byid = {}
    for m in re.finditer(r"<(symbol|clipPath|g|path)\b[^>]*\bid=\"([^\"]+)\"[^>]*?(?:/>|>.*?</\1>)",
                         defs, flags=re.S):
        byid[m.group(2)] = m.group(0)
    grow = True
    while grow:
        grow = False
        for i in list(used_ids):
            blk = byid.get(i)
            if not blk:
                continue
            for m in re.finditer(r'(?:xlink:)?href="#([^"]+)"|url\(#([^)]+)\)', blk):
                nid = m.group(1) or m.group(2)
                if nid not in used_ids:
                    used_ids.add(nid)
                    grow = True
    new_defs = "<defs>\n%s\n</defs>" % "\n".join(
        byid[i] for i in sorted(used_ids) if i in byid)
    body = fix_use_stroke_width(body)
    # ⚠️ **흰 바탕을 깔아 준다.** MuPDF 의 쪽 SVG 에는 배경이 없어서 `alpha=False`
    #    로 그리면 **온통 검게** 나온다(첫 대조에서 겹침 차이가 0.94 였다 —
    #    도형이 틀린 게 아니라 바탕이 없었던 것이다). 지면도 흰 종이라 이게 맞다.
    bg = '<rect x="0" y="0" width="%.3f" height="%.3f" fill="#fff"/>' % (w, h)
    return head + "\n" + new_defs + "\n" + bg + body, dropped, len(blocks)
