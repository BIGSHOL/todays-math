#!/usr/bin/env bash
# 재배정 규칙을 **망가뜨려 보고** 빨개지는지 확인한다. 초록이면 그 가드는 장식이다.
# (CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야 가드인 줄 안다」)
set -u
cd "$(dirname "$0")/../.."
F=scripts/classify/apply-polynomial-unit-fix.ts
T=src/__tests__/unit/polynomialUnitFix.test.ts
cp "$F" "$F.bak"
trap 'mv "$F.bak" "$F"' EXIT

fail=0
run() {
  if [ $? -ne 0 ]; then echo "?? $1 — 변이 자리를 못 찾음"; fail=1; cp "$F.bak" "$F"; return; fi
  if npx vitest run "$T" >/dev/null 2>&1; then
    echo "🟢 초록 — $1  ← 가드가 아니다"; fail=1
  else
    echo "🔴 빨강 — $1"
  fi
  cp "$F.bak" "$F"
}

# ① 음수 단항식을 다항식으로 읽는다 (함정 ⑴ 로 되돌아간다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('const POLY = String.raw\`\\\\((?:[^()+\\\\-][^()]*)?[^()+\\\\-][+\\\\-][^()]*\\\\)\`;','const POLY = String.raw\`\\\\([^()]*[+\\\\-][^()]*\\\\)\`;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "음수 단항식을 다항식으로 읽는다"

# ② 발문이 아니라 본문 전체를 본다 (함정 ⑵)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('const stem = stemOf(content);','const stem = content;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "발문이 아니라 본문 전체를 본다"

# ③ 발문 안의 «보기» 상자를 안 자른다 (함정 ⑶)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;i=s.index('export function stemOf')
j=s.index('}', s.index('[0]!;', i))+1
s=s[:i]+'export function stemOf(content: string): string {\n  return parseProblemContent(content).question;\n}'+s[j:]
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "발문 안의 «보기» 상자를 안 자른다"

# ④ 계수만 있는 괄호도 가져온다 (J20107 을 텅 비운다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('String.raw\`(^|[=+\\\\-×÷({\\\\[])\\\\s*-?[0-9]*[a-zA-Z](\\\\^\\\\{?[0-9]+\\\\}?)?\\\\s*×?\\\\s*\`','String.raw\`(^|[=+\\\\-×÷({\\\\[])\\\\s*-?[0-9]*[a-zA-Z]?(\\\\^\\\\{?[0-9]+\\\\}?)?\\\\s*×?\\\\s*\`')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "계수만 있는 괄호도 가져온다"

# ⑤ (다항식)×(다항식) 을 안 빼낸다 (중3 곱셈공식이 딸려 온다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('  if (TWO_POLY.test(b)) return false;','')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "중3 곱셈공식을 안 빼낸다"

# ⑥ 다른 단원 주제어를 안 본다
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('  if (OTHER_TOPIC.test(stem)) return false;','');assert s!=old,'자리 없음'
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "다른 단원 주제어를 안 본다"

# ⑦ 중3 단원까지 범위를 넓힌다
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('export const SOURCE_UNITS = [\"J20104\", \"J20106\", \"J20107\"] as const;','export const SOURCE_UNITS = [\"J20104\", \"J20106\", \"J20107\", \"J30201\"] as const;')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "중3 단원까지 범위를 넓힌다"

# ⑧ 원장이 옛 행을 덮어쓴다 (되돌릴 목적지가 사라진다)
python -c "
import io;p='$F';s=io.open(p,encoding='utf-8').read()
old=s;s=s.replace('  for (const r of next) if (!byId.has(r.id)) byId.set(r.id, r);','  for (const r of next) byId.set(r.id, r);')
io.open(p,'w',encoding='utf-8',newline='\n').write(s)"
run "원장이 옛 행을 덮어쓴다"

echo
[ "$fail" = 0 ] && echo "전부 빨강 — 가드가 실제로 지킨다." || echo "🔴 초록인 변이가 있다 — 위를 볼 것."
exit "$fail"
