#!/usr/bin/env bash
# 덩어리 단위 판정과 원장 누적을 **망가뜨려** 시험이 빨개지는지 본다.
#
# 🔴 가드는 망가뜨려 봐야 가드인 줄 안다. 그리고 이 하네스는
#    「파일이 바뀌었나」로 끝내지 않는다 — 변이가 적용됐는지 앵커로 확인하고,
#    앵커가 없으면 **판정하지 않고 멈춘다**(2026-08-20·21 에 두 번 속았다).
set -u
G=scripts/qa/spanGuards.ts
R=scripts/qa/repair-solution-hwp.ts
BG=$(mktemp); BR=$(mktemp)
cp "$G" "$BG"; cp "$R" "$BR"

restore() { cp "$BG" "$G"; cp "$BR" "$R"; }

run() { # $1=이름
  if cmp -s "$G" "$BG" && cmp -s "$R" "$BR"; then
    echo "[$1] 🔴 **파일이 그대로다 — 변이가 안 먹었다.** 판정 안 함"
    return
  fi
  local r
  r=$(npx vitest run src/__tests__/unit/spanGuards.test.ts 2>&1 \
        | grep -oE "Tests +[0-9]+ failed" | head -1)
  echo "[$1] ${r:-🟢 전부 초록 ← 가드가 아니다}"
  restore
}

# ① 잔재 가드를 끈다 → 날 `of` 가 그대로 나간다
python - "$G" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "  if (남은.length > 0) return { ok: false, why: \"잔재가 남았다\", 남은 };"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "  // 변이", 1))
PY
run "잔재 가드 제거"

# ② 수 세기를 집합으로 되돌린다 → 같은 수가 또 있으면 손실이 안 보인다
python - "$G" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "  for (const n of s.match(/\\d+/g) ?? []) m.set(n, (m.get(n) ?? 0) + 1);"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "  for (const n of s.match(/\\d+/g) ?? []) m.set(n, 1); // 변이", 1))
PY
run "수를 집합으로"

# ③ 걸린 덩어리가 있으면 그 행을 통째로 버린다(옛 동작) → 앞 덩어리도 안 고쳐진다
python - "$G" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = """    if (!v.ok) {
      버림.push({ why: v.why, 남은: v.남은 });
      continue;
    }"""
assert old in s, "앵커 없음"
new = """    if (!v.ok) {
      버림.push({ why: v.why, 남은: v.남은 });
      return { after: before, 바꾼수: 0, 버림 }; // 변이 — 옛 행 단위 동작
    }"""
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run "행 단위로 되돌리기"

# ④ 앞에서부터 갈아 끼운다 → 뒤 자리 오프셋이 흔들린다
python - "$G" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "  for (const p of [...pieces].sort((a, b) => b.start - a.start)) {"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "  for (const p of [...pieces].sort((a, b) => a.start - b.start)) { // 변이", 1))
PY
run "앞에서부터 갈아 끼우기"

# ⑤ 원장 누적에서 **마지막** before 를 쓴다 → 되돌려도 1차 결과로만 돌아간다
python - "$R" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "    byId.set(r.id, old ? { ...r, before: old.before } : r);"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "    byId.set(r.id, r); // 변이", 1))
PY
run "원장이 마지막 before 를 쓰기"

# ⑥ 원장을 덮어쓴다(누적 안 함) → 앞 회차 행이 사라진다
python - "$R" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding="utf-8").read()
old = "  const byId = new Map<string, LedgerRow>(prev.map((r) => [r.id, r]));"
assert old in s, "앵커 없음"
io.open(p, "w", encoding="utf-8").write(s.replace(old, "  const byId = new Map<string, LedgerRow>(); // 변이", 1))
PY
run "원장 덮어쓰기"

restore
cmp -s "$G" "$BG" && cmp -s "$R" "$BR" \
  && echo "원본 복구 확인 ok" || echo "🔴 복구 실패 — $BG · $BR 를 보라"
