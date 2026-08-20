#!/usr/bin/env bash
# 무리 짝짓기 검수 시트가 켠 옵트인들을 **망가뜨려 보고** 빨개지는지 확인한다.
# 초록이면 그 가드는 장식이다 (CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야 가드인 줄 안다」).
#
#   bash scripts/qa/mutate-rpm-group-pair.sh
#
# ⚠️ 변이가 **자리를 못 찾으면** 아무것도 안 바뀌고 시험이 그대로 통과한다 —
#    그건 「가드가 산다」가 아니라 **거짓 초록**이다. 그래서 치환마다 `assert` 를 붙인다
#    (2026-08-20 에 다른 변이 스크립트에서 실제로 둘이 그랬다).
set -u
cd "$(dirname "$0")/../.."
C=scripts/figure/crop-rpm-from-pdf.py
S=scripts/figure/sheet-rpm-group-pair.py
T=scripts/qa/test-rpm-group-pair.py
cp "$C" "$C.bak"; cp "$S" "$S.bak"
trap 'mv "$C.bak" "$C"; mv "$S.bak" "$S"' EXIT

fail=0
run() {
  if [ "$1" != 0 ]; then
    echo "?? $2 — 변이 자리를 못 찾음"; fail=1
    cp "$C.bak" "$C"; cp "$S.bak" "$S"; return
  fi
  if python "$T" >/dev/null 2>&1; then
    echo "🟢 초록 — $2  ← 가드가 아니다"; fail=1
  else
    echo "🔴 빨강 — $2"
  fi
  cp "$C.bak" "$C"; cp "$S.bak" "$S"
}

py() { python -c "$1"; }

# ① 두께 0인 곧은 선을 도로 버린다 (`thin_pt` 를 무시)
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('            if thin_pt <= 0 or (r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0):',
            '            if True:')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "곧은 선을 도로 버린다 (thin_pt 무시)"

# ② 울타리 밖으로 나가게 둔다
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('    if bound is not None:\n        out = out & bound\n', '')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "울타리 밖으로 나가게 둔다"

# ③ 부르는 쪽이 준 문턱을 무시한다
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('if out.is_empty or out.width < min_size[0] or out.height < min_size[1]:',
            'if out.is_empty or out.width < 30 or out.height < 20:')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "낮춘 문턱을 무시한다 (30x20 고정)"

# ④ 사람이 울타리를 그어도 «글자 속» 획을 버린다
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('        if not drop_inside_text:\n            return False\n', '')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "울타리를 그어도 «글자 속» 획을 버린다"

# ⑤ 두 축의 덩어리를 안 묶는다 (같은 그림에 번호가 둘 생긴다)
py "
import io
p='$S'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('            if same is None:', '            if True:')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "두 축의 덩어리를 안 묶는다"

# ⑥ 묶을 때 **작은 쪽**을 남긴다 (라벨이 잘린 네모가 남는다)
py "
import io
p='$S'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('            elif rect.get_area() > same.get_area():',
            '            elif rect.get_area() < same.get_area():')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "묶을 때 작은 쪽을 남긴다"

# ⑦ 덩어리 차례를 안 세운다 (번호가 실행마다 달라진다)
py "
import io
p='$S'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('    got.sort(key=lambda g: (round(g.y0, 0), g.x0))\n', '')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "덩어리 차례를 안 세운다"

# ⑧ 판정 안 적힌 대상을 조용히 넘긴다
py "
import io
p='$S'; s=io.open(p,encoding='utf-8').read(); o=s
i=s.index('    return [\n        m[\"id\"]\n        for g in sheet[\"목록\"]')
j=s.index('    ]\n', i)+len('    ]\n')
s=s[:i]+'    return []\n'+s[j:]
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "판정 안 적힌 대상을 조용히 넘긴다"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
