/**
 * 그림자 실행 — DB 직결과 API 가 **같은 것**을 주는가 (계획 3판 §3.4, codex #19·agy #10).
 *
 *   npx tsx --env-file=.env scripts/qa/shadow-eywa-transport.ts
 *
 * 전환 게이트다: 이 diff 가 0 이어야 EYWA_TRANSPORT=api 로 넘어가고, 그 뒤에만
 * `EYWA_DATABASE_URL` 을 지운다. 「이렇게 부르면 같다」는 추론이지 측정이 아니다 —
 * 같은 시점에 둘 다 돌려 **행 단위로** 대조한다(CLAUDE.md 2026-08-18 «분모 검산»).
 *
 * 두 스냅샷 사이에 원장님이 보고서를 쓰면 그 행만 갈린다 — 그래서 diff 를
 * 건수로 뭉개지 않고 **어느 행이 왜 다른지**를 찍는다. 양쪽에 다 있는데 내용이
 * 다른 것(🔴 구현 불일치)과 한쪽에만 있는 것(대개 시점 차)은 다른 부류다.
 */
import { createEywaClient } from "@/lib/eywa/client";
import {
  fetchViaApi,
  fetchViaDb,
  type EywaSnapshot,
} from "@/lib/eywa/transport";

function rosterMap(s: EywaSnapshot) {
  return new Map(
    s.roster.students.map((st) => [
      st.id,
      JSON.stringify({
        n: st.name,
        g: st.grade,
        s: st.school,
        c: [...st.classes].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    ]),
  );
}

function reportMap(s: EywaSnapshot) {
  return new Map(
    s.reports.map((r) => [
      r.id,
      JSON.stringify({
        st: r.studentId,
        d: r.reportDate,
        p: r.progress,
        c: r.classId,
        m: r.makeupClassId,
      }),
    ]),
  );
}

function diffMaps(
  label: string,
  a: Map<string, string>,
  b: Map<string, string>,
) {
  const 한쪽만A = [...a.keys()].filter((k) => !b.has(k));
  const 한쪽만B = [...b.keys()].filter((k) => !a.has(k));
  const 내용다름 = [...a.keys()].filter(
    (k) => b.has(k) && a.get(k) !== b.get(k),
  );
  console.log(`\n[${label}] db ${a.size} · api ${b.size}`);
  console.log(
    `  db 에만 ${한쪽만A.length} · api 에만 ${한쪽만B.length} · 🔴 내용 다름 ${내용다름.length}`,
  );
  for (const k of 내용다름.slice(0, 5)) {
    console.log(`  ── ${k}`);
    console.log(`     db : ${a.get(k)!.slice(0, 140)}`);
    console.log(`     api: ${b.get(k)!.slice(0, 140)}`);
  }
  for (const k of [...한쪽만A.slice(0, 3), ...한쪽만B.slice(0, 3)])
    console.log(`  (한쪽만) ${k}: ${(a.get(k) ?? b.get(k))!.slice(0, 100)}`);
  return { 한쪽만: 한쪽만A.length + 한쪽만B.length, 내용다름: 내용다름.length };
}

async function main() {
  const eywa = createEywaClient();
  console.log("두 전송을 같은 시점에 돌린다…");
  const [db, api] = await Promise.all([fetchViaDb(eywa), fetchViaApi()]);
  await eywa.$disconnect();

  const r = diffMaps("roster", rosterMap(db), rosterMap(api));
  const p = diffMaps("progress", reportMap(db), reportMap(api));

  console.log();
  if (r.내용다름 + p.내용다름 > 0) {
    console.error("🔴 내용이 다른 행이 있다 — 구현이 갈렸다. API 전환 금지.");
    process.exit(1);
  }
  if (r.한쪽만 + p.한쪽만 > 0) {
    console.log(
      "⚠️ 한쪽에만 있는 행 — 두 스냅샷 사이의 실데이터 변화일 수 있다. 다시 돌려 0 이면 통과.",
    );
    process.exit(2);
  }
  console.log("✅ diff 0 — EYWA_TRANSPORT=api 로 전환해도 된다.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
