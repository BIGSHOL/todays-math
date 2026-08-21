import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { connection } from "next/server";

import { packProblemsLegacy } from "../../../../scripts/qa/legacy/printPack-20260821";
import { JaseupTemplate } from "@/components/print/templates/JaseupTemplate";
import type {
  JaseupPrintMeta,
  TestPrintProblem,
} from "@/components/print/types";
import { db } from "@/lib/db";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { assessOverflowRisk, seatCapacities } from "@/lib/printOverflow";
import { packProblems } from "@/lib/printPack";

/**
 * **문항 길이가 장당 문항 수를 정한다** — 실물 지면 전후 비교 (내부 화면).
 *
 * 원장님 확정(2026-08-21): 「문항 길이에 따라 배치를 다르게. 길이가 긴 문항은
 * 2개를 넣을 수 없음. 길이가 길면 1개로.」 그대로 구현했고, 여기는 **종이에 대고
 * 확인하는 자리**다(절대 규칙 6 — 인쇄는 실물 검수까지가 완료 조건).
 *
 * ## 왜 이 화면이 있나
 *
 * 문항 칸은 `.problemItem { flex: 1 1 0% }` 라 **«그 장에 몇 개인가»**로 갈린다.
 * 옛 분할은 장당 둘로 못 박아서, 반 칸(첫 장 405px · 이어지는 장 484px)에 안
 * 들어가는 문항이 **옆 문항 위에 겹쳐 찍혔다.** 이제 그런 문항은 장을 통째로 쓴다.
 *
 * 왼쪽이 옛 분할, 오른쪽이 지금이다. **왼쪽은 흉내가 아니라 git 에서 꺼낸 옛
 * 코드**(`scripts/qa/legacy/printPack-20260821.ts`)를 그대로 부른다 — 흉내를 두면
 * 제품이 바뀔 때 비교만 옛것을 그린다(CLAUDE.md 2026-08-18).
 *
 * ## 🔴 가장 불리한 실데이터로 세운다
 *
 * 2026-08-19 에 범위 UI 시안을 **작은 픽스처**로 세웠다가, 실제 데이터에서 폼이
 * 화면 밖으로 밀리는 것을 원장님이 찾아 주셨다. 그래서 여기는 실측 높이 캐시에서
 * **실제로 경계를 가르는 문항**을 골라 세운다 — 캐시가 없으면 **그리지 않는다.**
 *
 * 다른 `/dev` 화면과 같은 가드 — `force-static` 을 쓰면 프로덕션에 구워진다.
 */

export const dynamic = "force-dynamic";

const CACHE = ".measure/cont-20260821.json";
const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";
const PANEL = "border-2 border-ink bg-side p-4";

const {
  firstPageSlot,
  continuationSlot,
  soloFirstPageSlot,
  soloContinuationSlot,
} = JASEUP_MEASURED_PX;

const META: JaseupPrintMeta = {
  academyName: "오늘의수학",
  title: "일일테스트 · 이차방정식",
  examDate: "2026-08-21",
  todayGoal: "이차방정식의 풀이를 확인하고 문제에 적용한다.",
  conceptNote:
    "이차방정식의 정의와 계산 원리를 확인한 뒤 풀이 과정에 적용한다.",
};

interface Row {
  pid: string;
  neededPx: number;
}

function readCache(): { rows: Row[] | null; why: string | null } {
  const full = path.join(process.cwd(), CACHE);
  if (!existsSync(full))
    return {
      rows: null,
      why:
        `높이 캐시가 없다: ${CACHE}\n` +
        "먼저 재라: npx tsx scripts/qa/measure-print-overflow.tsx --json " +
        CACHE,
    };
  try {
    return { rows: JSON.parse(readFileSync(full, "utf8")) as Row[], why: null };
  } catch {
    return { rows: null, why: `캐시를 읽을 수 없다: ${CACHE}` };
  }
}

export default async function PackByHeightPage() {
  await connection();
  const { rows, why } = readCache();

  /**
   * 🔴 캐시가 없으면 **가정값으로 내려가지 않는다.** 아무 문항이나 골라 그리면
   *    두 분할이 **똑같이** 나오는 지면이 만들어지고, 그걸 보시면 「달라진 게
   *    없네」로 읽으신다. 없는 것을 보여 주느니 왜 못 그리는지를 적는다.
   */
  if (!rows) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-extrabold">
          문항 길이가 장당 문항 수를 정한다 — 전후 비교
        </h1>
        <pre className={`${PANEL} mt-4 whitespace-pre-wrap text-xs`}>{why}</pre>
      </main>
    );
  }

  const 사이 = (lo: number, hi: number) =>
    rows
      .filter((r) => r.neededPx > lo && r.neededPx <= hi)
      .sort((a, b) => b.neededPx - a.neededPx);

  // 세 부류가 **다 있어야** 두 분할이 갈린다. 한 부류만 있으면 이 화면이 아무것도
  // 안 보여 준다 — 짧은 것 넷 · 첫 장에서만 큰 것 하나 · 반 칸을 넘는 것 하나.
  const 짧다 = 사이(0, firstPageSlot).slice(-40);
  const 중간 = 사이(firstPageSlot, continuationSlot).slice(0, 20);
  const 길다 = 사이(continuationSlot, soloFirstPageSlot).slice(0, 20);
  if (짧다.length < 4 || 중간.length < 1 || 길다.length < 1) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-extrabold">전후 비교</h1>
        <p className={`${PANEL} mt-4 text-sm`}>
          캐시에 세 부류가 다 있지 않다 — 짧다 {짧다.length} · 중간{" "}
          {중간.length} · 길다 {길다.length}. 이 화면은 부류가 갈리지 않으면
          아무것도 못 보여 준다.
        </p>
      </main>
    );
  }

  const 차례 = [짧다[0]!, 중간[0]!, 짧다[1]!, 길다[0]!, 짧다[2]!, 짧다[3]!];
  const picked = await db.problem.findMany({
    where: { id: { in: 차례.map((r) => r.pid) } },
    select: {
      id: true,
      content: true,
      answer: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
      problemCode: true,
    },
  });
  const byId = new Map(picked.map((p) => [p.id, p]));

  const problems: TestPrintProblem[] = 차례
    .map((r) => byId.get(r.pid))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p, i) => ({
      id: p.id,
      orderIndex: i,
      content: p.content,
      answer: p.answer,
      solution: null,
      figureUrls: p.figureUrls,
      figureDims: p.figureDims,
      figureSourceMm: p.figureSourceMm,
    }));

  const 높이 = new Map(차례.map((r) => [r.pid, r.neededPx]));
  const 칸이름 = (px: number) =>
    px === firstPageSlot
      ? "첫 장 반 칸"
      : px === continuationSlot
        ? "이어지는 장 반 칸"
        : px === soloFirstPageSlot
          ? "첫 장 통째"
          : "이어지는 장 통째";

  const 새분할 = packProblems(problems);
  const 옛분할 = packProblemsLegacy(problems);
  const 새자리 = seatCapacities(problems);
  const 새경고 = assessOverflowRisk(problems);

  /** 옛 분할에서의 자리 — 칸을 고르는 규칙은 안 바뀌었고 **분할만** 옛것이다. */
  const 옛자리: number[] = [];
  옛분할.forEach((page, pageIndex) => {
    const alone = page.problems.length === 1;
    const first = pageIndex === 0;
    const px = alone
      ? first
        ? soloFirstPageSlot
        : soloContinuationSlot
      : first
        ? firstPageSlot
        : continuationSlot;
    for (let i = 0; i < page.problems.length; i += 1) 옛자리.push(px);
  });

  const 겹침 = (자리: number[]) =>
    problems.filter((p, i) => (높이.get(p.id) ?? 0) > 자리[i]!).length;

  const 안 = [
    {
      key: "old",
      이름: "옛 분할 — 장당 두 문항 고정",
      pages: 옛분할,
      자리: 옛자리,
    },
    {
      key: "new",
      이름: "지금 — 문항 길이가 정한다",
      pages: 새분할,
      자리: 새자리,
    },
  ];

  return (
    <main className="mx-auto max-w-[1600px] p-8">
      <h1 className="text-xl font-extrabold">
        문항 길이가 장당 문항 수를 정한다 — 실물 지면 전후 비교
      </h1>

      <div className={`${PANEL} mt-4 text-sm leading-relaxed`}>
        <p className={MICRO}>무엇을 보시면 되나</p>
        <p className="mt-2">
          같은 문항 여섯을 <strong>분할만 바꿔</strong> 그린 것이다. 왼쪽에서는
          반 칸에 안 들어가는 문항이 <strong>옆 문항 위에 겹쳐 찍히고</strong>,
          오른쪽에서는 그 문항이 <strong>장을 통째로</strong> 쓴다. 대가는 장
          수다 — 여기서는 {옛분할.length}장 → {새분할.length}장.
        </p>
        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th className="py-1 pr-3">문항</th>
              <th className="py-1 pr-3">실측 높이</th>
              <th className="py-1 pr-3">옛 분할의 칸</th>
              <th className="py-1">지금의 칸</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p, i) => {
              const px = Math.round(높이.get(p.id) ?? 0);
              const 옛넘침 = px > 옛자리[i]!;
              const 새넘침 = px > 새자리[i]!;
              return (
                <tr key={p.id} className="border-b border-ink/20">
                  <td className="py-1 pr-3">
                    <code>{byId.get(p.id)?.problemCode}</code>
                  </td>
                  <td className="py-1 pr-3">{px}px</td>
                  <td className="py-1 pr-3">
                    {옛자리[i]}px ({칸이름(옛자리[i]!)}){" "}
                    {옛넘침 ? <strong>← 겹침</strong> : null}
                  </td>
                  <td className="py-1">
                    {새자리[i]}px ({칸이름(새자리[i]!)}){" "}
                    {새넘침 ? <strong>← 겹침</strong> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3">
          겹치는 문항{" "}
          <strong>
            {겹침(옛자리)}건 → {겹침(새자리)}건
          </strong>{" "}
          · 장{" "}
          <strong>
            {옛분할.length}장 → {새분할.length}장
          </strong>{" "}
          · 지금 지면의 인쇄 경고 {새경고.length}건
          {새경고.length > 0
            ? ` (${새경고.map((r) => `${r.number}번 ${r.reasons.join("·")}`).join(" / ")})`
            : ""}
        </p>
        <p className="mt-2 text-xs">
          전수 실측(시험지 6,270장 · 25문항): 겹치는 문항{" "}
          <strong>0.040 → 0.014건/장</strong> · 장 수{" "}
          <strong>13.000 → 13.021장</strong>. 남은 몫은 정책이 아니라 자
          (`estimateProblemPx`)의 놓침과 같은 자리다.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-8">
        {안.map((v) => (
          <section key={v.key}>
            <div className={`${PANEL} mb-3 w-[210mm]`}>
              <p className={MICRO}>{v.이름}</p>
              <p className="mt-1 text-sm">
                {v.pages.length}장 · 겹치는 문항{" "}
                <strong>{겹침(v.자리)}건</strong>
              </p>
            </div>
            {v.pages.map((page, index) => (
              <JaseupTemplate
                key={`${v.key}-${index}`}
                meta={META}
                page={index + 1}
                problems={page.problems}
                startingNumber={page.startingNumber}
              />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
