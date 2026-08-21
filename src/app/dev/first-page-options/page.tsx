import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { connection } from "next/server";

import { JaseupTemplate } from "@/components/print/templates/JaseupTemplate";
import type {
  JaseupPrintMeta,
  TestPrintProblem,
} from "@/components/print/types";
import { db } from "@/lib/db";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";

/**
 * 첫 장 칸 — **실물 지면 시안** (내부 화면, D-07 확정용).
 *
 * ## 왜 이 화면이 있나
 *
 * 첫 장 문항 칸은 405px 인데 이어지는 장은 484px 다(79px 차이 — 머리글 + 「◆ 핵심
 * 개념 정리」 상자). 그래서 **같은 문항이 1·2번이면 잘리고 3번이면 멀쩡**하다.
 * 전수 실측으로 첫 장에 안 들어가는 문항이 **3,653건(7.8%)** 이다.
 *
 * 고치면 **인쇄물의 배치가 바뀐다** → 원장님 확정 대상(D-07). 그래서 구현하지 않고
 * 여기에 **실제 문항으로 그린 지면**을 나란히 놓는다.
 *
 * ## 🔴 ASCII 로 고른 것은 확정이 아니다
 *
 * 2026-08-19 에 범위 UI 를 ASCII 로 견주어 ②를 고르셨다가, 실물을 보시고 ④로
 * 바꾸셨다. 그리고 그때 시안이 **작은 픽스처**로 서 있어서 「피커가 화면 밖으로
 * 밀린다」를 원장님이 화면에서 찾아 주셨다. 그래서 이 화면은 **가장 불리한 실데이터**
 * (첫 장 칸을 넘는 실제 문항)로 세운다.
 *
 * ## 🔴 「지금」쪽을 흉내 내지 않는다
 *
 * 네 안 모두 **같은 `JaseupTemplate`** 을 부른다. 다른 것은 ⑴ 첫 장에 문항을 몇 개
 * 넣는가와 ⑵ 개념 상자를 CSS 로 감추는가뿐이다. 옛 지면을 베껴 두면 제품이 바뀔 때
 * 시안만 옛것을 그린다.
 *
 * 다른 `/dev` 화면과 같은 가드 — `force-static` 을 쓰면 프로덕션에 구워진다.
 */

export const dynamic = "force-dynamic";

const CACHE = ".measure/first-20260821.json";
const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";
const PANEL = "border-2 border-ink bg-side p-4";

const META: JaseupPrintMeta = {
  academyName: "오늘의수학",
  title: "일일테스트 · 이차방정식",
  examDate: "2026-08-21",
  todayGoal: "이차방정식의 풀이를 확인하고 문제에 적용한다.",
  conceptNote:
    "이차방정식의 정의와 계산 원리를 확인한 뒤 풀이 과정에 적용한다.",
};

interface Variant {
  key: string;
  이름: string;
  칸: number;
  첫장문항수: number;
  개념상자: boolean;
  설명: string;
}

/**
 * 칸 높이는 **실측값**이다(`measure-first-page-header.tsx`). 손으로 적지 않는다 —
 * 두 곳이 따로 놀면 시안이 실제와 다른 크기를 보여 준다.
 */
const VARIANTS: Variant[] = [
  {
    key: "now",
    이름: "지금",
    칸: JASEUP_MEASURED_PX.firstPageSlot,
    첫장문항수: 2,
    개념상자: true,
    설명: "첫 장에 두 문항 · 개념 상자 있음",
  },
  {
    key: "solo",
    이름: "첫 장에 1문항만",
    칸: JASEUP_MEASURED_PX.soloFirstPageSlot,
    첫장문항수: 1,
    개념상자: true,
    설명: "칸을 혼자 쓴다 · 개념 상자는 그대로",
  },
  {
    key: "nobox",
    이름: "개념 상자를 뺀다",
    칸: 448,
    첫장문항수: 2,
    개념상자: false,
    설명: "장 수는 그대로 · 484px 에 36px 모자란다",
  },
  {
    key: "both",
    이름: "둘 다",
    칸: 881,
    첫장문항수: 1,
    개념상자: false,
    설명: "가장 넓다 · 개념 정리가 사라진다",
  },
];

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
        "먼저 재라: npx tsx scripts/qa/measure-print-overflow.tsx --first-page --json " +
        CACHE,
    };
  try {
    return { rows: JSON.parse(readFileSync(full, "utf8")) as Row[], why: null };
  } catch {
    return { rows: null, why: `캐시를 읽을 수 없다: ${CACHE}` };
  }
}

export default async function FirstPageOptionsPage() {
  await connection();
  const { rows, why } = readCache();

  /**
   * 🔴 캐시가 없으면 **가정값으로 내려가지 않는다.** 아무 문항이나 골라 그리면
   *    「첫 장에서 잘린다」가 안 보이는 지면이 나오고, 그걸 보고 정하시면 실제와
   *    다른 것을 정하시게 된다(figure-print-size 화면이 겪은 그 자리).
   */
  if (!rows) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-extrabold">첫 장 칸 — 실물 지면 시안</h1>
        <pre className={`${PANEL} mt-4 whitespace-pre-wrap text-xs`}>{why}</pre>
      </main>
    );
  }

  // 첫 장 칸(405px)은 넘지만 혼자 쓰는 칸(838px)에는 들어가는 문항 — 이 결정이
  // 실제로 가르는 부류다. 큰 것부터 셋을 고른다.
  const 후보 = rows
    .filter(
      (r) =>
        r.neededPx > JASEUP_MEASURED_PX.firstPageSlot &&
        r.neededPx <= JASEUP_MEASURED_PX.soloFirstPageSlot,
    )
    .sort((a, b) => b.neededPx - a.neededPx)
    .slice(0, 40);

  const picked = await db.problem.findMany({
    where: { id: { in: 후보.map((r) => r.pid) } },
    select: {
      id: true,
      content: true,
      answer: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
      problemCode: true,
    },
    take: 3,
  });

  const problems: TestPrintProblem[] = picked.map((p, i) => ({
    id: p.id,
    orderIndex: i,
    content: p.content,
    answer: p.answer,
    solution: null,
    figureUrls: p.figureUrls,
    figureDims: p.figureDims,
    figureSourceMm: p.figureSourceMm,
  }));

  const 높이 = new Map(후보.map((r) => [r.pid, r.neededPx]));

  return (
    <main className="mx-auto max-w-[1600px] p-8">
      <h1 className="text-xl font-extrabold">첫 장 칸 — 실물 지면 시안</h1>
      <div className={`${PANEL} mt-4 text-sm leading-relaxed`}>
        <p className={MICRO}>무엇을 보시면 되나</p>
        <p className="mt-2">
          아래 네 지면은 <strong>같은 문항 셋</strong>을 첫 장 배치만 바꿔 그린
          것이다. 일부러 <strong>첫 장 칸을 넘는 실제 문항</strong>을 골랐다 —
          「지금」에서는 문항 아래쪽이 잘리거나 다음 문항과 겹치고, 다른
          안에서는 들어간다.
        </p>
        <ul className="mt-3 list-disc pl-5">
          {picked.map((p) => (
            <li key={p.id}>
              <code>{p.problemCode}</code> — 필요한 높이{" "}
              <strong>{Math.round(높이.get(p.id) ?? 0)}px</strong> (첫 장 칸{" "}
              {JASEUP_MEASURED_PX.firstPageSlot}px)
            </li>
          ))}
        </ul>
        <p className="mt-3">
          장 수: 25문항이면 <strong>13장 그대로</strong>(홀수라 마지막 장이 원래
          한 칸 비어 있었다). 8·12·20문항처럼 짝수면 <strong>한 장 는다</strong>
          .
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-8">
        {VARIANTS.map((v) => (
          <section key={v.key}>
            <div className={`${PANEL} mb-3 w-[210mm]`}>
              <p className={MICRO}>{v.이름}</p>
              <p className="mt-1 text-sm">
                문항 칸 <strong>{v.칸}px</strong> · {v.설명}
              </p>
            </div>
            {/* 개념 상자는 **제품 코드를 안 고치고** 이 시안에서만 감춘다. */}
            {!v.개념상자 ? (
              <style>{`[data-variant="${v.key}"] section[class*="conceptBox"]{display:none}`}</style>
            ) : null}
            <div data-variant={v.key}>
              <JaseupTemplate
                meta={META}
                page={1}
                problems={problems.slice(0, v.첫장문항수)}
                startingNumber={1}
              />
              <JaseupTemplate
                meta={META}
                page={2}
                problems={problems.slice(v.첫장문항수)}
                startingNumber={v.첫장문항수 + 1}
              />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
