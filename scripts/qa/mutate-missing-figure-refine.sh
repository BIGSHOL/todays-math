#!/usr/bin/env bash
# 마무리 판정(refineUnclassified)의 가드를 **하나씩 망가뜨려** 시험이 빨개지는지 본다.
#
# 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18). 텍스트로만 확인하면
# 장식인 검사가 초록으로 남는다 — 실제로 28개가 전부 초록이던 적이 있다.
set -u
F=scripts/qa/missingFigureRule.ts
T=src/__tests__/unit/missingFigureRule.test.ts
BAK=$(mktemp)
cp "$F" "$BAK"
trap 'cp "$BAK" "$F"; rm -f "$BAK"' EXIT

run() {  # 이름, sed 표현식
  cp "$BAK" "$F"
  python - "$2" <<'PY'
import pathlib, sys
p = pathlib.Path("scripts/qa/missingFigureRule.ts")
old, new = sys.argv[1].split("§")
s = p.read_text(encoding="utf-8")
if old not in s:
    print("MUT-NOT-APPLIED"); sys.exit(9)
p.write_text(s.replace(old, new, 1), encoding="utf-8")
PY
  if [ $? -eq 9 ]; then echo "  ?? $1 — 변이가 안 붙었다 (검사 자체가 못 미덥다)"; return; fi
  if npx vitest run "$T" >/dev/null 2>&1; then
    echo "  ❌ $1 — 망가뜨렸는데 **초록**이다. 그 가드는 장식이다."
  else
    echo "  ✅ $1 — 빨강"
  fi
}

echo "── 변이 시험: 마무리 판정 ──"
run "성질을 묻는 말 요구를 뺀다 (전개도 문항이 전부 «불필요» 가 된다)" \
    'if (SOLID_PROPERTY.test(c) && ASKS_PROPERTY.test(c)) return "불필요";§if (SOLID_PROPERTY.test(c)) return "불필요";'
run "숫자 선택지 가드를 뺀다 (① 1 ② 2 … 를 그림 자국으로 본다)" \
    'return bodies.every((b) => /^[A-Za-z]{0,3}$/.test(b));§return bodies.every((b) => b.length <= 3 \&\& !/[가-힣]/.test(b));'
run "지면 표시(적힌) 검사를 뺀다 (전개도에 적힌 수 문항이 «불필요» 가 된다)" \
    'if (MARKED_ON_FIGURE.test(c)) return "유실";§if (false) return "유실";'
run "선택지 자국 검사를 뺀다" \
    'if (choicesAreFigureStubs(c)) return "유실";§if (false) return "유실";'
run "학생이 그린다 검사를 뺀다" \
    'if (STUDENT_DRAWS.test(c)) return "불필요";§if (false) return "불필요";'
run "마무리를 **앞단으로** 옮긴다 (미분류에만 건다는 순서를 깬다)" \
    'export function classifyFigure(content: string): FigureVerdict {
  const v = classifyFigureNeed(content);
  return v === "미분류" ? refineUnclassified(content) : v;
}§export function classifyFigure(content: string): FigureVerdict {
  const r = refineUnclassified(content);
  return r !== "미분류" ? r : classifyFigureNeed(content);
}'
echo "── 끝 (원본 복구됨) ──"
