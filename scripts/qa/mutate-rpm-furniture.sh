#!/usr/bin/env bash
# 쪽 장식 제외와 그 둘레 가드를 **망가뜨려 보고** 빨개지는지 확인한다.
# 초록이면 그 가드는 장식이다 (CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야 가드인 줄 안다」).
#
#   bash scripts/qa/mutate-rpm-furniture.sh
#
# ⚠️ 변이가 **자리를 못 찾으면** 아무것도 안 바뀌고 시험이 그대로 통과한다 —
#    그건 「가드가 산다」가 아니라 **거짓 초록**이다. 그래서 치환마다 `assert` 를 붙인다.
set -u
cd "$(dirname "$0")/../.."
C=scripts/figure/crop-rpm-from-pdf.py
S=scripts/figure/crop-pdf-by-stem.py
A=scripts/figure/apply-rpm-furniture.py
T=scripts/qa/test-rpm-furniture.py
cp "$C" "$C.bak"; cp "$S" "$S.bak"; cp "$A" "$A.bak"
trap 'mv "$C.bak" "$C"; mv "$S.bak" "$S"; mv "$A.bak" "$A"' EXIT

fail=0
run() {
  if [ "$1" != 0 ]; then
    echo "?? $2 — 변이 자리를 못 찾음"; fail=1
    cp "$C.bak" "$C"; cp "$S.bak" "$S"; cp "$A.bak" "$A"; return
  fi
  if python "$T" >/dev/null 2>&1; then
    echo "🟢 초록 — $2  ← 가드가 아니다"; fail=1
  else
    echo "🔴 빨강 — $2"
  fi
  cp "$C.bak" "$C"; cp "$S.bak" "$S"; cp "$A.bak" "$A"
}

py() { python -c "$1"; }

# ① 되풀이되는 획을 안 뺀다 (탭이 그림에 딸려 온다)
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('            if k in furniture:', '            if False:')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "되풀이되는 획을 안 뺀다"

# ② 한 쪽에만 나와도 장식으로 본다 (진짜 그림이 걸린다)
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('    return {k for k, pages in seen.items() if len(pages) >= FURNITURE_MIN_PAGES}',
            '    return set(seen)')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "한 쪽에만 나와도 장식으로 본다"

# ③ 거르는 쪽이 반올림을 **손으로** 적는다 (세는 쪽과 갈라진다)
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
# ⚠️ 같은 줄이 furniture_keys 안에도 있다 — 짧게 잡으면 **둘 다** 바뀌어
#    세는 쪽과 거르는 쪽이 여전히 같은 수를 쓰고, 변이가 거짓 초록이 된다(실제로 그랬다).
old='            k = tuple(int(round(v / FURNITURE_ROUND))'+chr(10)+'                      for v in (d[\"rect\"][0]'
assert s.count(old)==1, '자리가 하나가 아니다'
s=s.replace(old, '            k = tuple(int(round(v / 3))'+chr(10)+'                      for v in (d[\"rect\"][0]')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "거르는 쪽이 반올림을 손으로 적는다"

# ④ `crop-pdf-by-stem` 이 제 나름대로 다시 정의한다 (두 벌이 된다)
py "
import io
p='$S'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('furniture_keys = croprpm.furniture_keys',
            'def furniture_keys(doc):\n    return set()')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "crop-pdf-by-stem 이 제 나름대로 다시 정의한다"

# ⑤ 좁히지 않고 **결과 전량**을 붙일 것으로 넘긴다 (69행을 덮어쓴다)
py "
import io
p='$A'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('            if e in missing:', '            if True:')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "좁히지 않고 결과 전량을 넘긴다"

# ⑥ 뺀 것을 세지 않는다 (분모가 조용히 줄어든다)
py "
import io
p='$A'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('                why[\"그림이 이미 있다\" if e else \"유실 목록에 없다\"] += 1', '                pass')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "뺀 것을 세지 않는다"

# ⑦ 판정이 없는 행을 조용히 넘긴다
py "
import io
p='$A'; s=io.open(p,encoding='utf-8').read(); o=s
i=s.index('def missing_decisions('); j=s.index('\n\n', s.index('return [r[', i))
s=s[:i]+'def missing_decisions(keep, dec):\n    return []'+s[j:]
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "판정이 없는 행을 조용히 넘긴다"

# ⑧ 「이미있음」을 결과에 안 적는다
py "
import io
p='$C'; s=io.open(p,encoding='utf-8').read(); o=s
s=s.replace('                    {\"problemId\": it[\"problemId\"], \"publicPath\": to_public(out),\n                     \"이미있음\": True}',
            '                    {\"problemId\": it[\"problemId\"], \"publicPath\": to_public(out)}')
assert s!=o, '자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run $? "「이미있음」을 결과에 안 적는다"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
