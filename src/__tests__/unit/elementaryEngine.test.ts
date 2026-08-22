/**
 * 초3-1~초6-2 소단원 전량 생성. 정답은 생성기가 같은 숫자로 계산한다.
 * 그림 스펙이 있으면 엔진이 실제로 SVG 를 낸다 — 모킹하지 않는다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FRAC_FIG_MAX, fracFigParts, fracSpec } from "@/lib/elementary/fracFig";
import {
  G4_BAR_SCALES,
  G4_BAR_SPLITS,
  G4_BAR_THEMES,
  G4_LINE_THEMES,
  G4_THEME_SHARE,
} from "@/lib/elementary/g4";
import {
  elementaryChapters,
  elementaryUnits,
  generateElementaryProblem,
  handlerKeys,
} from "@/lib/elementary/generate";
import { renderFigureSpec } from "@/lib/figure/renderFigureSpec";

const VENDOR = path.join(process.cwd(), "vendor", "figure-engine");
const LEGACY = "F:\\시험지변환기";
const hasEngine = existsSync(VENDOR) || existsSync(LEGACY);

const UNITS = elementaryUnits();

/**
 * 정답에서 수를 꺼낸다 — **KaTeX 로 감싸졌는지도 함께 검사한다**(D-66 R1).
 *
 * 원장님이 정답 `4000`·`60` 이 날 글자로 나가는 것을 잡으셨다(2026-08-22). 그래서 이 검사는
 * 옛 `toBe(String(...))` 보다 **세다** — 값이 맞는지에 더해 표기까지 본다.
 * 감싸기를 빼면 이 자리가 빨개진다.
 */
function answerNumber(answer: string, label?: string): number {
  expect(answer, label).toMatch(/^\$[^$]+\$$/);
  const bare = answer
    .slice(1, -1)
    .replace(/\\[,;!]/g, "")
    .trim();
  expect(bare, label).toMatch(/^-?\d+(?:\.\d+)?$/);
  return Number(bare);
}

/**
 * 발문에서 «이름표가 붙은 수»를 꺼낸다. `가로 8 cm` 든 `가로 $8\,\mathrm{cm}$` 든 같이 잡힌다 —
 * 표기(R1)가 바뀌어도 검산은 그대로 서 있어야 하기 때문이다.
 * 이름표 자체는 여전히 요구하므로 «아무 수나 통과»하지는 않는다.
 */
function labeled(content: string, label: string): number {
  const hit = content.match(new RegExp(`${label}\\D*?(\\d+(?:\\.\\d+)?)`));
  expect(hit, `${label} 을(를) 발문에서 못 찾음: ${content}`).toBeTruthy();
  return Number(hit![1]);
}

/**
 * 「평균」 문항의 **꼴을 가르고 그 꼴의 식으로 검산**한다.
 *
 * 꼴이 셋이고 검산식이 서로 다르다 — 뭉뚱그리면 한쪽이 거짓 빨강이 된다.
 *
 * | 꼴 | 판별자 | 검산 |
 * |---|---|---|
 * | `평균묻기`   | `…의 평균을 구하시오`        | 답 `= Σ ÷ 개수` |
 * | `합되찾기`   | `평균이 $A$…입니다 … 모두 더하면` | 답 `= N × A` |
 * | `빠진값찾기` | `그중 $N-1$명의 … 이고, $N$명의 평균은` | 답 `= N × A − Σ나열`, 나열은 **N−1개** |
 *
 * ⚠️ 예전에는 「의 평균」으로 잘라 **앞의 수를 전부 자료로** 셌다. `빠진값찾기` 가 들어오자
 *    인원수(`$6$명`·`$5$명`)까지 자료로 세고, 나열된 수는 **한 명이 빠진 것**이라 거짓 빨강이
 *    났다(2026-08-22). 그때 「그 꼴은 건너뛴다」로 막으면 그 소단원은 이 검사에서 **구조적으로
 *    0** 이 된다 — 그래서 건너뛰지 않고 **각자의 식으로** 검산한다.
 *
 * 어디에도 안 걸리면 `미분류` 를 낸다. **조용히 통과시키지 않는다** — 새 꼴이 들어오면
 * 사람이 보고 식을 정해야 한다(「손 목록은 샌다」, 09 §4-22).
 */
export function averageVerdict(
  content: string,
  answer: number,
): { form: string; ok: boolean; why: string } {
  const missingOne = content.match(
    /그중 \$(\d+)\$명의 [^$]*?\$([^$]+)\$[^$]*?\$(\d+)\$명의 평균은 \$([\d.]+)\$/,
  );
  if (missingOne) {
    const shownCount = Number(missingOne[1]);
    const shown = (missingOne[2]!.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const count = Number(missingOne[3]);
    const avg = Number(missingOne[4]);
    const want = count * avg - shown.reduce((a, b) => a + b, 0);
    if (shownCount !== count - 1)
      return {
        form: "빠진값찾기",
        ok: false,
        why: `나열 인원 ${shownCount} ≠ ${count - 1}`,
      };
    if (shown.length !== count - 1)
      return {
        form: "빠진값찾기",
        ok: false,
        why: `나열 ${shown.length}개 ≠ ${count - 1}개`,
      };
    if (answer !== want)
      return {
        form: "빠진값찾기",
        ok: false,
        why: `답 ${answer} ≠ ${count}×${avg}−Σ = ${want}`,
      };
    // 「나머지 한 명」이 음수·0 이면 문항이 성립하지 않는다.
    if (answer <= 0)
      return {
        form: "빠진값찾기",
        ok: false,
        why: `답이 ${answer} — 양수가 아니다`,
      };
    return { form: "빠진값찾기", ok: true, why: "" };
  }

  const sumBack = content.match(/\$(\d+)\$명의 [^$]*?평균이 \$([\d.]+)\$/);
  if (sumBack) {
    const want = Number(sumBack[1]) * Number(sumBack[2]);
    return answer === want
      ? { form: "합되찾기", ok: true, why: "" }
      : {
          form: "합되찾기",
          ok: false,
          why: `답 ${answer} ≠ ${sumBack[1]}×${sumBack[2]} = ${want}`,
        };
  }

  const asked = content.split("의 평균을 구하시오")[0];
  if (asked !== undefined && asked !== content) {
    const listed = (asked.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (listed.length <= 1)
      return { form: "평균묻기", ok: false, why: `자료가 ${listed.length}개` };
    const sum = listed.reduce((a, b) => a + b, 0);
    if (sum % listed.length !== 0)
      return {
        form: "평균묻기",
        ok: false,
        why: `합 ${sum} 이 ${listed.length} 로 안 나눠떨어진다`,
      };
    const want = sum / listed.length;
    return answer === want
      ? { form: "평균묻기", ok: true, why: "" }
      : { form: "평균묻기", ok: false, why: `답 ${answer} ≠ ${want}` };
  }

  return content.includes("평균")
    ? { form: "미분류", ok: false, why: "평균 문항인데 검산할 꼴을 못 골랐다" }
    : { form: "평균아님", ok: true, why: "" };
}

describe("[초등 엔진] 소단원 전량", () => {
  it("초3~초6 소단원이 230개다", () => {
    expect(UNITS).toHaveLength(230);
    expect(new Set(UNITS.map((u) => u.grade))).toEqual(
      new Set(["초3", "초4", "초5", "초6"]),
    );
  });

  it("대단원 48개마다 생성기가 있다", () => {
    const chapters = elementaryChapters();
    expect(chapters).toHaveLength(48);
    const keys = new Set(handlerKeys());
    const missing = chapters
      .map((c) => `${c.grade}|${c.chapter}`)
      .filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it("초3-1~초6-2 소단원 230개가 모두 문항을 낸다", () => {
    const failed: string[] = [];
    for (const unit of UNITS) {
      try {
        const item = generateElementaryProblem(unit, 20260821);
        if (item.section !== unit.section)
          failed.push(`${unit.section}: section`);
        if (item.content.trim().length < 8)
          failed.push(`${unit.section}: 발문`);
        if (!item.answer || item.answer.length < 1)
          failed.push(`${unit.section}: 정답`);
        if (!item.solution) failed.push(`${unit.section}: 해설`);
      } catch (err) {
        failed.push(`${unit.grade} ${unit.section}: ${String(err)}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("같은 씨앗이면 같은 정답이 나온다", () => {
    const unit = UNITS[0]!;
    const a = generateElementaryProblem(unit, 7);
    const b = generateElementaryProblem(unit, 7);
    expect(a.answer).toBe(b.answer);
    expect(a.content).toBe(b.content);
  });

  it("세 자리 덧셈 정답은 두 수의 합이다", () => {
    const unit = UNITS.find((u) => u.section.includes("받아올림이 없는"))!;
    const item = generateElementaryProblem(unit, 11);
    const hit = item.content.match(/(\d{3})\s*\+\s*(\d{3})/);
    expect(hit, item.content).toBeTruthy();
    expect(answerNumber(item.answer, unit.section)).toBe(
      Number(hit![1]) + Number(hit![2]),
    );
  });

  it("직육면체 부피 정답은 가로×세로×높이이다", () => {
    const unit = UNITS.find((u) => u.section.includes("직육면체의 부피 비교"))!;
    const item = generateElementaryProblem(unit, 11);
    expect(answerNumber(item.answer, unit.section)).toBe(
      labeled(item.content, "가로") *
        labeled(item.content, "세로") *
        labeled(item.content, "높이"),
    );
  });

  it("쌓기나무 정답은 voxel 개수이다", () => {
    const unit = UNITS.find((u) =>
      u.section.includes("쌓은 모양과 쌓기나무의 개수 알아보기 (1)"),
    )!;
    const item = generateElementaryProblem(unit, 11);
    const spec = item.figureSpec as { voxels: unknown[] };
    expect(spec.voxels.length).toBe(answerNumber(item.answer, unit.section));
  });

  it("막대그래프는 눈금과 막대 숫자가 있고 흰 외곽선으로 뭉개지 않는다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "barChart",
      values: [
        { label: "사과", value: 14 },
        { label: "배", value: 8 },
      ],
      yMax: 18,
      yLabel: "명",
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.svg).toContain(">14<");
    expect(drawn.svg).toContain(">8<");
    expect(drawn.svg).toContain(">0<");
    expect(drawn.svg).toContain(">10<");
    expect(drawn.svg).toContain(">15<");
    expect(drawn.svg).not.toMatch(/stroke="#fff"/);
    expect(drawn.svg).not.toContain(">2<");
    expect(drawn.svg).not.toContain(">4<");
  });

  it("막대그래프 세로축 단위는 눈금 숫자와 겹치지 않는다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "barChart",
      values: [
        { label: "개", value: 15 },
        { label: "고양이", value: 4 },
      ],
      yMax: 20,
      yLabel: "마리",
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    const textY = (label: string) => {
      const m = drawn.svg.match(new RegExp(`y="([0-9.]+)"[^>]*>${label}<`));
      expect(m, `${label} 좌표`).toBeTruthy();
      return Number(m![1]);
    };
    expect(textY("마리")).toBeLessThan(textY("20") - 14);
  });

  // 원장님 (2026-08-22): 「그림그래프도 **학생 말고 다양한 항목**으로」
  // 「항상 도형은 다양할수록 좋음. 너무 단조로우면 재미도 학습의욕도 떨어짐」
  //
  // ⚠️ 옛 검사는 `labels.some((row) => !row.startsWith("월,"))` 였다. 막대그래프에서
  // 요일 소재가 아예 빠진 뒤로 그 줄은 **어떤 씨앗에서도 참**이라 아무것도 안 갈랐다.
  // 「가드가 아니라 장식」이 된 자리다 — 소재가 한 가지로 무너지면 **빨개지는** 형태로 고쳤다.
  it("막대그래프 소재는 소단원마다 · 씨앗마다 갈린다", () => {
    const units = UNITS.filter((u) => u.chapter.includes("막대그래프"));
    expect(units.length).toBeGreaterThan(0);
    const row = (unit: (typeof units)[number], seed: number) => {
      const spec = generateElementaryProblem(unit, seed).figureSpec as {
        values: { label: string }[];
      };
      return spec.values.map((v) => v.label).join(",");
    };

    // ① 소단원이 다르면 소재가 다르다 — 원장님이 ④·⑨ 로 두 번 지적하신 자리다
    const byUnit = units.map((u) => row(u, 20260821));
    expect(new Set(byUnit).size, `소단원별 소재\n${byUnit.join("\n")}`).toBe(
      units.length,
    );

    // ② 씨앗이 다르면 소재가 다르다 — 「문제마다 똑같은 것」을 여기서 잡는다
    for (const unit of units) {
      const bySeed = new Set(
        [20260821, 7, 1234, 99991, 555, 4242].map((s) => row(unit, s)),
      );
      expect(
        bySeed.size,
        `${unit.section} 씨앗별 소재\n${[...bySeed].join("\n")}`,
      ).toBeGreaterThan(1);
    }
  });

  // 원장님 (2026-08-22): 「소재는 다양할수록 좋다」
  //
  // ⚠️ 위 검사는 이 결함을 **구조적으로 못 본다.** 「소단원마다 다르다 · 씨앗마다 다르다」는
  // 살아남은 소재 몇 개만으로도 참이기 때문이다. 실제로 `FAMILIES[orderIndex % length]` 로
  // 무리를 고르던 때 **막대 14개 중 8개, 꺾은선 8개 중 2개가 한 번도 안 나오고 있었다**
  // (실측 소단원 3 × 씨앗 400). 위 검사는 그동안 내내 초록이었다.
  //
  // ⚠️ 기대 목록을 **손으로 나열하지 않는다** — 손 목록은 샌다. 생성기가 쓰는 **바로 그 배열**을
  //    가져와 대조한다(세는 쪽과 만드는 쪽이 같은 것을 봐야 한다).
  it("적어 둔 소재는 하나도 빠짐없이 나오고, 소단원끼리 겹치지 않는다", () => {
    const SEEDS = Array.from({ length: 120 }, (_, i) => 20260000 + i * 7);

    // ⚠️ **열쇠는 소재를 하나로 가려낼 수 있어야 한다.** 처음엔 가로축 라벨로 셌는데,
    //    「박물관에 온 관람객 수」와 「우리 반이 읽은 책 수」가 둘 다 `1월~5월` 이라
    //    **서로 다른 소재가 같은 것으로 보였다** — 겹치지도 않았는데 겹쳤다고 빨개졌다.
    //    소재의 신원은 «주제»다. 꺾은선은 발문의 주제로, 막대는 라벨 묶음으로 가른다
    //    (막대는 주제가 겹쳐도 라벨이 다르고, 발문에 주제가 그대로 안 나온다).
    const sweep = (
      chapter: string,
      expected: Set<string>,
      keyOf: (content: string, labels: string[]) => string | undefined,
    ) => {
      const units = UNITS.filter(
        (u) => u.grade === "초4" && u.chapter.includes(chapter),
      );
      expect(units.length, `${chapter} 소단원을 못 찾았다`).toBeGreaterThan(0);
      // 소재를 하나도 안 적었으면 「전부 나왔다」가 공허하게 참이 된다.
      expect(expected.size, `${chapter} 소재 목록이 비었다`).toBeGreaterThan(5);

      const seenBy = new Map<string, Set<string>>();
      for (const unit of units) {
        const mine = new Set<string>();
        for (const seed of SEEDS) {
          const item = generateElementaryProblem(unit, seed);
          const spec = item.figureSpec as {
            values?: { label: string }[];
          } | null;
          if (!spec?.values) continue;
          const key = keyOf(
            item.content,
            spec.values.map((v) => v.label),
          );
          expect(key, `소재를 가려내지 못했다: ${item.content}`).toBeTruthy();
          mine.add(key!);
        }
        seenBy.set(unit.section, mine);
      }

      // ① 적어 둔 소재가 전부 나온다 — 죽은 소재가 하나도 없다
      const seen = new Set([...seenBy.values()].flatMap((s) => [...s]));
      const dead = [...expected].filter((row) => !seen.has(row));
      expect(
        dead,
        `${chapter}: 한 번도 안 나오는 소재\n${dead.join("\n")}`,
      ).toEqual([]);

      // ② 소단원끼리 소재가 겹치지 않는다 — 시험지에 같은 것이 나란히 안 나간다
      const rows = [...seenBy.entries()];
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          const both = [...rows[i]![1]].filter((r) => rows[j]![1].has(r));
          expect(
            both,
            `${rows[i]![0]} 와 ${rows[j]![0]} 가 소재를 공유한다\n${both.join("\n")}`,
          ).toEqual([]);
        }
      }
    };

    sweep(
      "막대그래프",
      new Set(G4_BAR_THEMES.map((t) => t.labels.join(","))),
      (_content, labels) => labels.join(","),
    );
    sweep(
      "꺾은선그래프",
      new Set(G4_LINE_THEMES.map((t) => t.topic)),
      (content) =>
        // 긴 주제가 짧은 주제를 품는 일이 없게 **긴 것부터** 맞춰 본다.
        [...G4_LINE_THEMES]
          .map((t) => t.topic)
          .sort((a, b) => b.length - a.length)
          .find((topic) => content.includes(topic)),
    );
  });

  // 막대 소재 열넷은 **전부 「좋아하는 것을 고른 학생 수(명)」** 라 값 범위를 한 벌로 함께 쓴다.
  // 꺾은선은 소재마다 단위가 달라(kg·℃·cm·mm) 소재별로 갈랐지만, 여기서 똑같이 갈랐다면
  // **안 갈라도 되는 축을 가르는** 것이다(손 표가 하나 늘고, 그 표가 낡는다).
  //
  // 그래서 「언제 갈라야 하는가」를 이 검사가 알려 준다 — 단위가 「명」이 아닌 소재가 들어오면
  // 빨개진다. **그때가 나눌 때다. 지금이 아니라.**
  it("막대그래프 소재는 전부 학생 수다 — 아니면 값 범위를 갈라야 한다", () => {
    const notPeople = G4_BAR_THEMES.filter((t) => t.unit !== "명");
    expect(
      notPeople.map((t) => `${t.item}(${t.unit})`),
      "단위가 「명」이 아닌 소재가 생겼다 — 값 범위를 한 벌로 쓸 수 없다. 규모/띠를 나누십시오",
    ).toEqual([]);
    expect(G4_BAR_THEMES.length, "소재가 비었다").toBeGreaterThan(5);
    // 이 검사가 실제로 무엇을 보는지 — 단위가 다른 소재를 대면 걸려야 한다.
    const poison = [
      ...G4_BAR_THEMES,
      { item: "학용품", unit: "원", labels: ["a", "b", "c", "d"] },
    ];
    expect(
      poison.filter((t) => t.unit !== "명"),
      "단위가 다른 소재를 못 잡는다",
    ).not.toEqual([]);
  });

  // ⚠️ 「우리 반 학생 40명」은 「1개월에 9kg」과 **같은 부류**다 — 값 하나하나가 그럴듯해도
  //    **이름이 그 값에서 참이 아니다.** 그래서 합계를 상한으로 «막지» 않고, 총원을 먼저 뽑아
  //    나눠서 **구성으로 참이 되게** 한다. 이 검사는 그 짝이 어긋나면 빨개진다.
  it("막대그래프의 규모 이름과 값이 짝이 맞는다", () => {
    const bars = UNITS.filter(
      (u) => u.grade === "초4" && u.chapter.includes("막대"),
    );
    expect(bars.length).toBeGreaterThan(0);
    let checked = 0;
    const bad: string[] = [];
    for (const unit of bars) {
      for (let i = 0; i < 120; i += 1) {
        const item = generateElementaryProblem(unit, 20260000 + i * 7);
        const spec = item.figureSpec as { values: { value: number }[] };
        const scale = G4_BAR_SCALES.find((sc) => item.content.includes(sc.who));
        expect(scale, `규모 이름을 못 찾았다: ${item.content}`).toBeTruthy();
        const values = spec.values.map((v) => v.value);
        const sum = values.reduce((a, b) => a + b, 0);
        const top = Math.max(...values);
        checked += 1;
        if (!scale!.totals.includes(sum)) {
          bad.push(
            `${scale!.who}: 합계 ${sum} — 그 규모의 총원이 아니다 [${scale!.totals.join(",")}]`,
          );
        }
        if (top > scale!.maxTop || top < scale!.minTop) {
          bad.push(
            `${scale!.who}: 최댓값 ${top} — ${scale!.minTop}~${scale!.maxTop} 이어야 한다`,
          );
        }
        if (top > sum / 2)
          bad.push(
            `${scale!.who}: 한 항목이 총원의 절반을 넘는다 (${top}/${sum})`,
          );
        for (const v of values) {
          if (v % scale!.step !== 0) {
            bad.push(
              `${scale!.who}: ${v} 는 눈금 ${scale!.step} 의 배수가 아니다 — 「몇 칸」이 자연수가 아니게 된다`,
            );
          }
        }
        if (new Set(values).size !== values.length) {
          bad.push(
            `${scale!.who}: 값이 겹친다 [${values.join(",")}] — 「가장 많은 것」의 답이 둘이 된다`,
          );
        }
      }
    }
    const uniq = [...new Set(bad)];
    expect(uniq, uniq.join("\n")).toEqual([]);
    expect(checked, "막대 표본을 하나도 못 모았다").toBeGreaterThan(200);
  });

  // ⚠️ 위 검사는 발문에서 규모를 `content.includes(who)` 로 되찾는다. 그래서 어떤 `who` 가
  //    다른 `who` 를 **품으면** `find` 가 «먼저 있는 쪽»을 집어 **엉뚱한 규모의 띠로 채점**한다.
  //    실제로 걸릴 뻔했다 — 걸음 10 규모를 「$3$학년과 $4$학년 학생들」로 적으면 그 문자열이
  //    「$4$학년 학생들」을 통째로 품는다. 이름을 「…전체 학생」으로 바꿔 피했고, 다음 사람이
  //    자연스러운 이름을 골랐다가 **조용히** 같은 자리에 빠지지 않게 여기서 막는다.
  it("규모 이름은 서로를 품지 않는다 — 안 그러면 발문에서 규모를 되찾을 수 없다", () => {
    const bad: string[] = [];
    for (const a of G4_BAR_SCALES) {
      for (const b of G4_BAR_SCALES) {
        if (a === b) continue;
        if (a.who.includes(b.who)) {
          bad.push(
            `「${a.who}」 가 「${b.who}」 를 품는다 — find 가 뒤엣것을 못 집는다`,
          );
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
    // 「짝이 하나도 없어서」 조용히 통과하지 않게 — 셀 수 있는 형태인지 확인한다.
    expect(
      G4_BAR_SCALES.length,
      "규모가 둘 미만이면 이 검사는 아무것도 안 본다",
    ).toBeGreaterThan(1);
  });

  // ⚠️ 조건 넷(총원 고정 · 서로 다름 · 눈금의 배수 · 최댓값이 절반 이하)이 겹치면
  //    **못 푸는 총원**이 생긴다. 그러면 생성기가 실행 중에 던진다 — 원장님 화면에서.
  //    그러니 총원 후보 전부에 해가 있는지 **커밋 전에** 여기서 센다.
  it("막대그래프 총원 후보는 전부 나눌 수 있다", () => {
    const bad: string[] = [];
    for (const scale of G4_BAR_SCALES) {
      for (const total of scale.totals) {
        const n = G4_BAR_SPLITS(total, scale).length;
        if (n === 0) bad.push(`${scale.who} 총원 ${total}: 나눌 방법이 없다`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
    // 「하나도 못 셌다」로 조용히 통과하지 않게.
    expect(G4_BAR_SCALES.length, "규모가 비었다").toBeGreaterThan(1);
    // 그리고 못 푸는 총원을 대면 실제로 0 이 나오는지 — 이 검사가 셀 수 있는 형태인지 본다.
    const impossible = G4_BAR_SPLITS(3, G4_BAR_SCALES[0]!);
    expect(impossible, "못 푸는 총원인데 해가 있다고 한다").toEqual([]);
  });

  // 원장님 (D-70): 「눈금 몇칸 유형도 넣어. 유형은 다양할수록 환영」
  //
  // ⚠️ 이 유형이 한때 통째로 빠졌던 까닭은 **발문이 그림과 다른 말을 해서**였다 —
  //    발문은 「한 칸 $1$명」이라 우기는데 그림은 `_y_step` 이 고른 걸음으로 그렸다.
  //    이제 걸음을 `yStep` 으로 스펙에 실으므로, **발문·해설이 말하는 수 == 스펙의 yStep**
  //    을 여기서 잠근다. (그려진 SVG 의 걸음 == yStep 은 파이썬 쪽 시험이 잠근다.)
  //
  //    「$5$명」처럼 KaTeX 로 감싸인 수만 본다 — R1 때문에 발문의 수는 전부 그 꼴이다.
  it("눈금을 말하는 발문·해설의 수는 스펙에 실은 yStep 과 같다", () => {
    const graphUnits = UNITS.filter(
      (u) =>
        u.grade === "초4" &&
        (u.chapter.includes("막대") || u.chapter.includes("꺾은선")),
    );
    expect(graphUnits.length).toBeGreaterThan(0);
    let checked = 0;
    const bad: string[] = [];
    for (const unit of graphUnits) {
      for (let i = 0; i < 120; i += 1) {
        const item = generateElementaryProblem(unit, 20260000 + i * 7);
        const spec = item.figureSpec as { yStep?: number } | null;
        const text = `${item.content}\n${item.solution}`;
        // 「한 칸은/이 $N$…」 — 걸음을 말하는 자리를 **전부** 모은다.
        //
        // ⚠️ 처음엔 `눈금 한 칸` 으로 잡았는데 해설의 「한 칸이 $2$명이고」·「한 칸은 $5$명입니다」
        //    를 통째로 놓쳤다(19자리만 셌다). **「눈금」이 늘 앞에 붙지는 않는다** —
        //    좁게 잡은 열쇠는 세는 쪽만 눈이 멀게 한다.
        const said = [...text.matchAll(/한 칸[은이]\s*\$([\d.]+)\$/g)].map(
          (m) => Number(m[1]),
        );
        if (said.length === 0) continue;
        expect(
          spec?.yStep,
          `걸음을 말하는데 스펙에 yStep 이 없다: ${item.content}`,
        ).toBeTruthy();
        checked += said.length;
        for (const v of said) {
          if (v !== spec!.yStep) {
            bad.push(
              `${unit.section}: 발문/해설은 한 칸 ${v} 라는데 스펙 yStep 은 ${spec!.yStep} ` +
                `— 발문이 그림과 다른 말을 한다\n    ${item.content}`,
            );
          }
        }
      }
    }
    const uniq = [...new Set(bad)];
    expect(uniq, uniq.join("\n")).toEqual([]);
    // 0 은 「깨끗」과 「못 셈」을 구분해 주지 않는다 — 눈금 유형이 사라지면 여기서 걸린다.
    expect(
      checked,
      "눈금을 말하는 발문을 하나도 못 찾았다 — 유형이 빠졌나",
    ).toBeGreaterThan(20);
  });

  // 걸음을 실으면 엔진은 **그 걸음 그대로** 긋는다 — 사다리를 안 탄다. 그래서 눈금이
  // `MAX_Y_TICKS`(9)줄을 넘으면 **던진다.** 범위를 넓히다 그 선을 넘는 것을 여기서 먼저 잡는다.
  it("실은 yStep 으로 눈금이 9줄을 넘지 않는다", () => {
    const graphUnits = UNITS.filter(
      (u) =>
        u.grade === "초4" &&
        (u.chapter.includes("막대") || u.chapter.includes("꺾은선")),
    );
    let checked = 0;
    const bad: string[] = [];
    for (const unit of graphUnits) {
      for (let i = 0; i < 120; i += 1) {
        const spec = generateElementaryProblem(unit, 20260000 + i * 7)
          .figureSpec as {
          values?: { value: number }[];
          yStep?: number;
        } | null;
        if (!spec?.values || !spec.yStep) continue;
        checked += 1;
        const top = Math.max(...spec.values.map((v) => v.value));
        const ticks = Math.ceil(top / spec.yStep) + 1;
        if (ticks > 9) {
          bad.push(
            `${unit.section}: 최댓값 ${top} · 걸음 ${spec.yStep} → 눈금 ${ticks}줄 (9줄 이하여야 한다)`,
          );
        }
      }
    }
    const uniq = [...new Set(bad)];
    expect(uniq, uniq.join("\n")).toEqual([]);
    expect(checked, "yStep 을 실은 그림을 하나도 못 찾았다").toBeGreaterThan(
      200,
    );
  });

  /** 꺾은선 소단원의 값들을 훑는다 — 값은 발문이 아니라 **그림 스펙**에 있다. */
  const sweepLine = (
    visit: (topic: string, values: number[], content: string) => void,
  ) => {
    let seen = 0;
    for (const unit of UNITS.filter(
      (u) => u.grade === "초4" && u.chapter.includes("꺾은선"),
    )) {
      for (let i = 0; i < 120; i += 1) {
        const item = generateElementaryProblem(unit, 20260000 + i * 7);
        const spec = item.figureSpec as { values?: { value: number }[] } | null;
        if (!spec?.values) continue;
        const topic = G4_LINE_THEMES.map((t) => t.topic).find((t) =>
          item.content.includes(t),
        );
        expect(topic, `소재를 못 찾았다: ${item.content}`).toBeTruthy();
        visit(
          topic!,
          spec.values.map((v) => v.value),
          item.content,
        );
        seen += 1;
      }
    }
    // 0 은 「깨끗」과 「못 셈」을 구분해 주지 않는다.
    expect(seen, "꺾은선 표본을 하나도 못 모았다").toBeGreaterThan(200);
  };

  // 원장님 (2026-08-22): 「소재는 알아서 다양하게 · 4학년 꺾은선 수준에 맞게」 「큰 눈금 써도 된다」
  //
  // 「강아지의 무게가 **1개월에 9~14kg**」이 표본의 100% 였다(실측 2026-08-22).
  //
  // ⚠️ **평평한 띠로는 이걸 못 잡는다.** 9kg 은 강아지 무게로 «있을 수 있는» 값이다 — 틀린 것은
  //    크기가 아니라 **자리와 값의 어긋남**(1개월인데 9kg)이다. 그래서 `first` 를 따로 둔다.
  //    박물관(월 9~32명)은 반대로 `all` 로 걸린다 — **두 결함이 서로 다른 축에서 잡힌다.**
  //    한 축만 만들었으면 하나는 샜을 것이다.
  // ⚠️ 기대 범위를 `G4_LINE_THEMES` 에서 읽어 오면 안 된다 — 제품 범위를 넓히면 기대도 같이
  //    넓어져 **영원히 초록**이다(2026-08-18). 손으로 못 박고, 「흔한 값」이 아니라
  //    **「있을 수 없는 값」**으로 긋는다(좁게 그으면 거짓 경보가 나고, 거짓 경보는 가드를 끈다).
  it("꺾은선그래프 값은 그 소재에 **세상에서 있을 수 있는** 값이다", () => {
    const BANDS: {
      topic: string;
      unit: string;
      first?: [number, number];
      all: [number, number];
    }[] = [
      { topic: "교실의 기온", unit: "℃", all: [-20, 40] },
      { topic: "운동장의 기온", unit: "℃", all: [-20, 40] },
      { topic: "강낭콩의 키", unit: "cm", first: [1, 20], all: [1, 80] },
      { topic: "고구마 싹의 키", unit: "cm", first: [1, 20], all: [1, 80] },
      { topic: "도서관에 온 학생 수", unit: "명", all: [1, 2000] },
      { topic: "박물관에 온 관람객 수", unit: "명", all: [50, 100000] },
      { topic: "우리 반이 읽은 책 수", unit: "권", all: [1, 500] },
      { topic: "강아지의 무게", unit: "kg", first: [1, 6], all: [1, 60] },
      { topic: "하루 동안 내린 비의 양", unit: "mm", all: [0, 300] },
    ];
    const check = (topic: string, values: number[]): string[] => {
      const band = BANDS.find((b) => b.topic === topic);
      if (!band) return [`띠를 안 정한 소재: ${topic}`];
      const bad: string[] = [];
      const head = values[0]!;
      if (band.first && (head < band.first[0] || head > band.first[1])) {
        bad.push(
          `${topic}: 첫값 ${head}${band.unit} — ${band.first[0]}~${band.first[1]} 이어야 한다`,
        );
      }
      for (const v of values) {
        if (v < band.all[0] || v > band.all[1]) {
          bad.push(
            `${topic}: ${v}${band.unit} 은 세상에 없다 (${band.all[0]}~${band.all[1]})`,
          );
        }
      }
      return bad;
    };

    // ── 눈금: 틀린 것은 걸리고(양성) 멀쩡한 것은 통과해야(음성) 한다
    expect(
      check("강아지의 무게", [12, 14, 17, 20, 24]),
      "1개월 12kg 을 못 잡는다",
    ).not.toEqual([]);
    expect(
      check("강낭콩의 키", [90, 95, 100, 110, 120]),
      "강낭콩 90cm 를 못 잡는다",
    ).not.toEqual([]);
    expect(
      check("강낭콩의 키", [6, 12, 20, 30, 44]),
      "강낭콩 12cm 은 멀쩡하다",
    ).toEqual([]);
    expect(
      check("교실의 기온", [9, 12, 18, 25, 31]),
      "기온 9℃ 는 멀쩡하다",
    ).toEqual([]);
    expect(
      check("강아지의 무게", [3, 6, 10, 15, 20]),
      "정상 강아지가 걸린다",
    ).toEqual([]);

    // ── 전량
    const bad: string[] = [];
    sweepLine((topic, values) => bad.push(...check(topic, values)));
    const uniq = [...new Set(bad)];
    expect(uniq, `세상에 없는 값\n${uniq.join("\n")}`).toEqual([]);
  });

  // ⚠️ `step` 이 상수라 「차가 모두 다르다」는 **자동으로** 지켜진다. 그래도 시험을 뺄 수 없다 —
  //    `step` 이 상수가 아니게 되는 순간 조용히 깨지고, 그러면 「가장 많이 변한 때」의 답이 둘이 된다.
  it("꺾은선 값은 자연수이고, 이웃한 차가 모두 다르고, 자라는 소재는 줄지 않는다", () => {
    // 손으로 못 박는다 — `G4_LINE_THEMES.rising` 을 읽으면 제품이 곧 기대가 되어 영원히 초록이다.
    const RISING = new Set(["강낭콩의 키", "고구마 싹의 키", "강아지의 무게"]);
    // 큰 눈금을 쓰는 소재는 값이 **읽히는 수**여야 한다 (`237` 이 아니라 `250`).
    const READABLE: Record<string, number> = {
      "도서관에 온 학생 수": 2,
      "우리 반이 읽은 책 수": 2,
      "하루 동안 내린 비의 양": 2,
    };
    const bad: string[] = [];
    sweepLine((topic, values) => {
      for (const v of values) {
        if (!Number.isInteger(v) || v < 1)
          bad.push(`${topic}: ${v} 는 자연수가 아니다`);
        const unit = READABLE[topic];
        if (unit && v % unit !== 0)
          bad.push(`${topic}: ${v} 는 ${unit} 의 배수가 아니다`);
      }
      const diffs = values.slice(1).map((v, i) => Math.abs(v - values[i]!));
      if (new Set(diffs).size !== diffs.length) {
        bad.push(
          `${topic}: 이웃한 차가 겹친다 [${diffs.join(",")}] — 「가장 많이 변한 때」의 답이 둘이 된다`,
        );
      }
      if (RISING.has(topic)) {
        for (let i = 1; i < values.length; i += 1) {
          if (values[i]! <= values[i - 1]!) {
            bad.push(`${topic}: 자라는 것이 줄었다 [${values.join(",")}]`);
          }
        }
      }
    });
    const uniq = [...new Set(bad)];
    expect(uniq, uniq.join("\n")).toEqual([]);
  });

  // ⚠️ **값이 맞는 것과 지면이 읽히는 것은 다르다.** 「박물관 월 관람객 400~1600명」은
  //    세상에 있을 수 있는 값이고 위 검사들을 전부 통과했다. 그런데 실제로 그려 보니
  //    **세로축 눈금이 231줄**이라 숫자가 뭉개진 그림이 나왔다 — PNG 로 눈으로 보고서야 알았다.
  //
  //    원인은 `scripts/figure/elem_advanced.py` 의 `_y_step` 이다. `y_max` 가 12 를 넘으면
  //    눈금 간격을 **5 로 고정**해서, 최댓값이 커질수록 눈금 줄이 그대로 늘어난다.
  //    (`y_max/5` 줄. 그래서 최댓값 150 짜리 도서관 그래프도 23줄로 못 읽었다.)
  //
  //    원장님이 「큰 눈금 써도 된다」고 하셨지만 **엔진이 아직 못 그린다.** `_y_step` 이
  //    눈금을 스스로 고르게 되면 이 한계를 올리고 박물관 같은 소재를 되살릴 수 있다.
  it("꺾은선 값은 지면이 **읽히게 그릴 수 있는** 눈금 안이다", () => {
    // **한계를 올렸다** (2026-08-22). 예전 60 은 「`_y_step` 이 5에서 멈춰 눈금이 y_max/5 줄」
    // 이던 때의 값이다. 그림 세션이 `_axis_top` 으로 걸음을 사다리 삼게 고쳐, 실측으로
    // `yMax 1153` 이 **7줄**(`0·200·…·1200`)로 나온다(브루트포스 5만 조합 위반 0).
    // ⚠️ **검사 자체는 남긴다** — 숫자만 올린다. 없애면 다음 사람이 또 231줄을 만든다.
    const MAX_READABLE = 2000;
    const bad: string[] = [];
    sweepLine((topic, values) => {
      const top = Math.max(...values);
      if (top > MAX_READABLE) {
        bad.push(
          `${topic}: 최댓값 ${top} — 세로축 눈금이 ${Math.ceil(top / 5)}줄이 되어 못 읽는다 ` +
            `(${MAX_READABLE} 이하여야 한다)`,
        );
      }
    });
    const uniq = [...new Set(bad)];
    expect(uniq, uniq.join("\n")).toEqual([]);
  });

  it("소재 나눠 갖기는 전 학년에서 안 터지고, 소재가 모자라면 터진다", () => {
    // ⚠️ `themeShare` 의 `throw` 가 **실행 중에** 터지면 그 순간 문항이 안 나온다 — 원장님 화면에서.
    //    그러니 소단원이 늘거나 소재를 줄일 때 **커밋 전에** 여기서 빨개져야 한다.
    const failed: string[] = [];
    for (const unit of UNITS) {
      for (const seed of [7, 20260821, 99991]) {
        try {
          generateElementaryProblem(unit, seed);
        } catch (err) {
          failed.push(
            `${unit.grade} ${unit.section} (씨앗 ${seed}): ${String(err)}`,
          );
        }
      }
    }
    expect(failed, failed.join("\n")).toEqual([]);

    // 그리고 그 `throw` 자체를 **일부러 터뜨려 본다.** 안 터지면 그 가드는 장식이다.
    const anyUnit = UNITS.find(
      (u) => u.grade === "초4" && u.chapter.includes("막대그래프"),
    )!;
    expect(
      () => G4_THEME_SHARE(anyUnit, ["하나뿐"]),
      "소재가 하나인데 안 터진다",
    ).toThrow(/소재가 모자랍니다/);
    // 넉넉하면 안 터진다 (음성 대조군)
    expect(() =>
      G4_THEME_SHARE(anyUnit, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    ).not.toThrow();
  });

  it("띠그래프·원그래프는 비율 구성이 여러 가지다", () => {
    const units = UNITS.filter((u) => u.chapter.includes("여러 가지 그래프"));
    expect(units.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    const labelRows = new Set<string>();
    for (const unit of units) {
      for (let seed = 0; seed < 20; seed += 1) {
        const spec = generateElementaryProblem(unit, seed).figureSpec as {
          segments?: { label: string; pct: number }[];
          slices?: { label: string; pct: number }[];
        };
        const items = spec.segments ?? spec.slices ?? [];
        expect(items.reduce((s, it) => s + it.pct, 0)).toBe(100);
        keys.add(items.map((it) => it.pct).join(","));
        labelRows.add(items.map((it) => it.label).join(","));
      }
    }
    expect(keys.size).toBeGreaterThan(6);
    expect(labelRows.size).toBeGreaterThan(2);
    expect([...labelRows].some((row) => !row.startsWith("가"))).toBe(true);
  });

  it("평균 정답은 나누어떨어지는 자연수이다", () => {
    const units = UNITS.filter(
      (u) =>
        u.chapter.includes("평균과 가능성") && !u.section.includes("가능성"),
    );
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      for (let seed = 0; seed < 40; seed += 1) {
        const item = generateElementaryProblem(unit, seed);

        // 이 검사의 알맹이 — 평균 답에 소수가 새면 안 된다. 문항 모양이 바뀌어도 이건 성립한다.
        const answer = answerNumber(
          item.answer,
          `${unit.section} seed=${seed}`,
        );
        expect(
          Number.isInteger(answer),
          `${unit.section}: ${item.answer}`,
        ).toBe(true);

        // 꼴을 가르고 **그 꼴의 식으로** 검산한다. 규칙은 `averageVerdict` 한 곳에만 두고
        // 아래 「눈금」검사가 그 함수를 픽스처로 시험한다 — 두 벌이면 한쪽만 고쳐도 모른다.
        const v = averageVerdict(item.content, answer);
        expect(
          v.ok,
          `${unit.section} [${v.form}] ${v.why} — ${item.content}`,
        ).toBe(true);
      }
    }
  });

  it("평균 문항의 수는 **세상에서 있을 수 있는** 값이다", () => {
    // 「선수 $5$명의 **키**를 조사했더니 평균이 $33$ cm」가 실측 51/200 이었다(2026-08-22).
    // **가드 넷이 전부 못 본다** — 산술도 표기도 소단원 조건도 맞다. 「이 수가 그 낱말과
    // 어울리는가」는 코드가 아니라 **세상**이 정하기 때문이다.
    //
    // ⚠️ 기대 범위를 `AVG_TOPICS` 에서 **읽어 오면 안 된다.** 읽어 오면 제품 범위를 넓힐 때
    //    기대값도 같이 넓어져 **영원히 초록**이다 — 참이 제품에서 오면 제품이 틀릴수록 좋은
    //    점수를 낸다(2026-08-18). 그래서 아래 값은 손으로 못 박는다.
    //
    // ⚠️ 「흔한 값」이 아니라 **「있을 수 없는 값」**으로 긋는다. 좁게 그으면 멀쩡한 문항이
    //    걸리고, **거짓 경보는 가드를 끈다**(2026-08-20). 그래서 `수학 점수 $2$점` 은
    //    통과시키고 `$103$점`·`키 $33$cm` 처럼 **불가능한 것만** 잡는다.
    const BANDS: { topic: string; unit: string; lo: number; hi: number }[] = [
      { topic: "몸무게", unit: "kg", lo: 15, hi: 70 },
      { topic: "키", unit: "cm", lo: 100, hi: 190 },
      { topic: "점수", unit: "점", lo: 0, hi: 100 },
      { topic: "줄넘기", unit: "번", lo: 1, hi: 300 },
      { topic: "시간", unit: "분", lo: 1, hi: 240 },
    ];
    const avgUnits = UNITS.filter((u) => u.section.includes("평균"));
    expect(avgUnits.length, "평균 소단원을 못 찾았다").toBeGreaterThan(0);

    let checked = 0;
    for (const unit of avgUnits) {
      for (let seed = 0; seed < 60; seed += 1) {
        const { content } = generateElementaryProblem(unit, seed);
        for (const band of BANDS) {
          if (!content.includes(band.topic)) continue;
          // `$34$ kg` 과 `$62,\ 64$점` 을 같이 잡는다 — 한 덩어리 안의 수를 전부 본다.
          const re = new RegExp(`\\$([^$]+)\\$\\s*${band.unit}`, "g");
          for (const hit of content.matchAll(re)) {
            for (const raw of hit[1]!.match(/\d+(?:\.\d+)?/g) ?? []) {
              const value = Number(raw);
              checked += 1;
              expect(
                value >= band.lo && value <= band.hi,
                `${unit.section}: ${band.topic} ${value}${band.unit} 은 세상에 없다 ` +
                  `(${band.lo}~${band.hi}) — ${content}`,
              ).toBe(true);
            }
          }
        }
      }
    }
    // **0 은 「깨끗」과 「못 셈」을 구분해 주지 않는다.** 아무것도 안 봤으면 멈춘다.
    expect(
      checked,
      "수를 하나도 검사하지 못했다 — 발문 모양이 바뀌었나",
    ).toBeGreaterThan(100);
  });

  it("평균 검산기 눈금 — 맞는 답은 통과하고 틀린 답은 걸린다", () => {
    // ⚠️ **양성만 대면 「재현율」만 재고 「지어냄」은 구조적으로 0** 이다(2026-08-20).
    //    그래서 꼴마다 «맞는 답»과 «틀린 답»을 **둘 다** 넣는다. 위 전량 검사는 늘
    //    맞는 답만 주므로, 이 함수가 **빨개질 수 있는지**를 저 혼자서는 못 보여 준다.
    const 빠진값 =
      "학생 $6$명의 수학 점수를 조사했습니다. 그중 $5$명의 수학 점수는 " +
      "$62,\\ 64,\\ 68,\\ 60,\\ 78$점이고, $6$명의 평균은 $68$점입니다. " +
      "나머지 한 명의 수학 점수는 몇 점인가?";
    const 합되찾기 =
      "학생 $5$명의 몸무게를 조사했더니 평균이 $34$kg입니다. " +
      "학생 $5$명의 몸무게를 모두 더하면 몇 kg인가?";
    const 평균묻기 = "$24,\\ 18,\\ 21,\\ 29$의 평균을 구하시오.";

    // 양성 — 맞는 답은 통과해야 한다. (408 = 6×68, Σ=332 → 76)
    expect(averageVerdict(빠진값, 76)).toMatchObject({
      form: "빠진값찾기",
      ok: true,
    });
    expect(averageVerdict(합되찾기, 170)).toMatchObject({
      form: "합되찾기",
      ok: true,
    });
    expect(averageVerdict(평균묻기, 23)).toMatchObject({
      form: "평균묻기",
      ok: true,
    });

    // 음성 — 답이 틀리면 **반드시** 걸려야 한다. 안 걸리면 이 검사는 장식이다.
    expect(averageVerdict(빠진값, 77).ok, "빠진값: 틀린 답이 통과했다").toBe(
      false,
    );
    expect(
      averageVerdict(합되찾기, 171).ok,
      "합되찾기: 틀린 답이 통과했다",
    ).toBe(false);
    expect(
      averageVerdict(평균묻기, 24).ok,
      "평균묻기: 틀린 답이 통과했다",
    ).toBe(false);

    // 「나머지 한 명」이 0 이하인 문항은 성립하지 않는다.
    const 음수 = 빠진값.replace(
      "$6$명의 평균은 $68$점",
      "$6$명의 평균은 $50$점",
    );
    expect(averageVerdict(음수, 300 - 332).ok, "음수 답이 통과했다").toBe(
      false,
    );

    // 나열 개수가 인원과 안 맞으면 걸린다(한 명을 빠뜨리거나 더 적었다).
    const 개수틀림 = 빠진값.replace(
      "$62,\\ 64,\\ 68,\\ 60,\\ 78$",
      "$62,\\ 64,\\ 68,\\ 60$",
    );
    expect(
      averageVerdict(개수틀림, 76).ok,
      "나열 개수가 틀렸는데 통과했다",
    ).toBe(false);

    // **새 꼴은 조용히 지나가지 않는다.** 이게 없으면 다음 갈래가 검산 밖으로 샌다.
    expect(averageVerdict("평균 키가 가장 큰 반을 고르시오.", 3)).toMatchObject(
      {
        form: "미분류",
        ok: false,
      },
    );
    // 평균과 무관한 문항까지 붙잡지는 않는다(거짓 경보는 가드를 끈다 — 2026-08-20).
    expect(averageVerdict("$3\\times4$ 의 값을 구하시오.", 12)).toMatchObject({
      form: "평균아님",
      ok: true,
    });
  });

  it("선대칭·점대칭 그림은 격자 블록만 쓰지 않는다", () => {
    const line = UNITS.find((u) => u.section.includes("선대칭도형과 그 성질"))!;
    const point = UNITS.find((u) =>
      u.section.includes("점대칭도형과 그 성질"),
    )!;
    const lineMotifs = new Set<string>();
    const pointMotifs = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      const a = generateElementaryProblem(line, seed).figureSpec as {
        motif?: string;
      };
      const b = generateElementaryProblem(point, seed).figureSpec as {
        motif?: string;
      };
      expect(a.motif).toBeTruthy();
      expect(b.motif).toBeTruthy();
      lineMotifs.add(a.motif!);
      pointMotifs.add(b.motif!);
    }
    expect(lineMotifs.size).toBeGreaterThan(1);
    expect(pointMotifs.size).toBeGreaterThan(1);
  });

  it("가·나 그림이면 이름을 묻지 않는다", () => {
    const bad: string[] = [];
    for (const unit of UNITS) {
      const item = generateElementaryProblem(unit, 20260821);
      const spec = item.figureSpec as {
        kind?: string;
        items?: { label?: string }[];
      } | null;
      if (spec?.kind !== "namedShapes") continue;
      const labeled = (spec.items ?? []).some(
        (it) => it.label === "가" || it.label === "나",
      );
      if (labeled && item.content.includes("이름을 쓰시오")) {
        bad.push(unit.section);
      }
    }
    expect(bad).toEqual([]);
  });

  it("변의 길이 분류는 세 변이 같은 삼각형의 기호를 고른다", () => {
    const unit = UNITS.find((u) =>
      u.section.includes("변의 길이에 따라 분류"),
    )!;
    const item = generateElementaryProblem(unit, 20260821);
    expect(item.content).toMatch(/기호/);
    expect(item.answer).toBe("가");
    const spec = item.figureSpec as {
      items: { shape: string; label: string }[];
    };
    expect(
      spec.items.some((it) => it.shape === "eqTri" && it.label === "가"),
    ).toBe(true);
  });

  // 원장님 ⑤ (2026-08-22): 「세 변의 길이가 모두 같은 삼각형의 기호를 쓰시오」인데
  // **그림에 등변 표시가 이미 찍혀 있어** 문제가 성립하지 않았다.
  // **묻는 속성을 그림이 답해 주면 안 된다**(R6). 여기서 잠근다.
  it("정삼각형을 고르라는 문항의 그림에는 등변 표시가 없다", async () => {
    const unit = UNITS.find((u) =>
      u.section.includes("변의 길이에 따라 분류"),
    )!;
    // 등변 표시는 `<line>` 로 그려진다 — `marks: true` 대조군으로 확인한 열쇠다.
    // 이 열쇠가 맞는지부터 본다. 안 그러면 아래 `0` 이 「없다」인지 「못 센다」인지 모른다.
    const control = await renderFigureSpec({
      version: "elem-1",
      kind: "namedShapes",
      items: [{ shape: "eqTri", label: "가", marks: true }],
    } as never);
    expect(control.ok, "대조군 렌더 실패").toBe(true);
    if (!control.ok) return;
    const marks = (svg: string) => (svg.match(/<line/g) ?? []).length;
    expect(
      marks(control.svg),
      "표시를 켰는데 못 센다면 이 검사는 장식이다",
    ).toBe(3);

    for (const seed of [20260821, 99991, 4242, 555]) {
      const item = generateElementaryProblem(unit, seed);
      if (!item.content.includes("기호")) continue; // 치수로 묻는 갈래는 그림이 없다
      const drawn = await renderFigureSpec(item.figureSpec as never);
      expect(drawn.ok, `${seed} 렌더 실패`).toBe(true);
      if (!drawn.ok) return;
      expect(marks(drawn.svg), `씨앗 ${seed}: ${item.content}`).toBe(0);
    }
  });

  // ⑤ 의 **뒷면** (elem-g4, 2026-08-22): tick 을 없앴더니 이번엔 **가릴 수가 없어졌다.**
  // 곁들이 `isoTri` 는 변이 44:49:49 라 정삼각형과 **거의 같아 보인다** — PNG 로 뽑아
  // 눈으로 보고서야 드러났다(수치만 보면 「12% 차이니 갈리겠지」 싶다).
  //
  // 「그림이 답을 알려 주면 안 된다」(R6)의 뒷면은 **「그림으로 답을 낼 수는 있어야 한다」**이다.
  // 참은 상수가 아니라 **그려진 SVG** 에서 가져온다.
  //
  // 실측 변 비(최장/최단, 2026-08-22 16:36): 정삼각형 **1.000** ·
  // wideTri **1.306** · rightTri **1.414** · isoTri **1.795**.
  // 1.000 과 1.306 **사이가 비어 있으므로** 1.25 는 칼날 위가 아니다 —
  // 문턱을 눈대중이 아니라 **분포에서** 골랐다.
  //
  // ⚠️ 이 수치는 **그림 엔진이 바꾸면 낡는다.** 처음 쟀을 때 `isoTri` 는 **1.118** 이었고
  // (그래서 초4 세션이 곁들이에서 뺐다), 그 뒤 그림 세션이 `ISO_TRI_BASE = 0.58` 로
  // 밑변을 좁혀 1.795 가 됐다. **가드는 상수가 아니라 그려진 SVG 를 재므로 그대로 산다.**
  // 낡는 것은 이 주석과 «무엇이 결함인가»뿐이다 — 변이 하네스도 같이 손봐야 한다.
  it("정삼각형을 고르라는 문항의 곁들이는 한눈에 갈린다", async () => {
    const unit = UNITS.find((u) =>
      u.section.includes("변의 길이에 따라 분류"),
    )!;
    /** 그려진 다각형의 변 비 — 정삼각형이면 1에 가깝다. */
    const sideRatios = (svg: string) =>
      [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => {
        const pts = m[1]!
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number) as [number, number]);
        const sides = pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length]!;
          return Math.hypot(p[0] - q[0], p[1] - q[1]);
        });
        return Math.max(...sides) / Math.min(...sides);
      });

    // ⚠️ 씨앗 몇 개만 그려 보면 **곁들이 풀을 다 못 밟는다.** 실제로 씨앗 6개짜리 판은
    // 「isoTri 를 풀에 되돌리는」 변이에 **초록**이었다 — 그 씨앗들이 isoTri 를 안 뽑았다.
    // 「초록이면 가드를 고치기 전에 픽스처가 경계를 가르는지부터 보라」(CLAUDE.md 2026-08-21).
    // 그래서 씨앗을 훑어 **나올 수 있는 도형을 전부 모은 뒤** 도형마다 한 번씩만 그려 잰다 —
    // 렌더 횟수는 오히려 줄고 덮는 범위는 풀 전체가 된다.
    const answerShapes = new Set<string>();
    const distractors = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      const item = generateElementaryProblem(unit, seed);
      if (!item.content.includes("기호")) continue;
      const spec = item.figureSpec as {
        items: { shape: string; label: string }[];
      };
      for (const it of spec.items) {
        (it.label === item.answer ? answerShapes : distractors).add(it.shape);
      }
    }
    expect(
      answerShapes.size,
      "그림 갈래를 한 번도 안 밟았다 — 아무것도 안 본 검사다",
    ).toBeGreaterThan(0);
    expect(distractors.size, "곁들이가 없다").toBeGreaterThan(0);

    const ratioOf = async (shape: string) => {
      const one = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape, label: "가" }],
      } as never);
      expect(one.ok, `${shape} 렌더 실패`).toBe(true);
      if (!one.ok) return Number.NaN;
      return sideRatios(one.svg)[0]!;
    };

    for (const shape of answerShapes) {
      expect(
        await ratioOf(shape),
        `정답 도형 ${shape} 가 정삼각형이 아니다`,
      ).toBeLessThan(1.02);
    }
    for (const shape of distractors) {
      const r = await ratioOf(shape);
      expect(
        r,
        `곁들이 ${shape} 변 비 ${r.toFixed(3)} — 정삼각형과 구별이 안 된다`,
      ).toBeGreaterThanOrEqual(1.25);
    }
  });

  it("분수 그림 등분이 크면 스펙을 만들지 않는다", () => {
    expect(() => fracSpec(() => 0, 30, 25)).toThrow(/12/);
    expect(() => fracSpec(() => 0, 16, 5)).toThrow(/12/);
  });

  // 등분 수를 어디에 적는지는 kind 마다 다르다. 모르는 kind 를 만나면 **소리 내어 막아야** 한다 —
  // 조용히 `NaN` 을 내면 위 「그릴 수 있는 등분만」 검사가 「그림이 없다」로 잘못 읽힌다.
  // 실제로 `trapFour`(개수 키를 안 들고 다닌다) 에서 그렇게 빨개져 한참 헤맸다(2026-08-22).
  it("분수 그림 등분 읽기는 모르는 kind 를 조용히 넘기지 않는다", () => {
    expect(fracFigParts({ kind: "fracBars", cols: 6 })).toBe(6);
    expect(fracFigParts({ kind: "fracPie", n: 5 })).toBe(5);
    expect(fracFigParts({ kind: "triRow", n: 3 })).toBe(3);
    expect(fracFigParts({ kind: "trapFour" })).toBe(4); // 이름이 곧 「넷」이다 (D-61)
    expect(() => fracFigParts({ kind: "hexRing" })).toThrow(/fracFigParts/);
    expect(() => fracFigParts({})).toThrow(/fracFigParts/);
  });

  it("크기가 같은 분수는 그릴 수 있는 등분만 그림으로 붙인다", () => {
    const visual = UNITS.find((u) => u.section.includes("크기가 같은 분수"))!;
    const compute = UNITS.find((u) => u.section.includes("분수를 간단하게"))!;
    for (let seed = 1; seed <= 30; seed++) {
      const shown = generateElementaryProblem(visual, seed);
      expect(shown.figureSpec, `seed ${seed} 그림`).toBeTruthy();
      const spec = shown.figureSpec as {
        kind?: string;
        cols?: number;
        n?: number;
      };
      // 등분 수는 kind 마다 다른 키에 적힌다(`trapFour` 는 아예 안 적는다).
      // 그 규칙은 **만드는 쪽 옆**(`fracFig.ts`)에 하나만 둔다 — 여기 옮겨 적으면 두 벌이 된다.
      const parts = fracFigParts(spec);
      expect(
        parts,
        `seed ${seed} 등분 (kind=${spec.kind})`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        parts,
        `seed ${seed} 등분 (kind=${spec.kind})`,
      ).toBeLessThanOrEqual(FRAC_FIG_MAX);
      const calc = generateElementaryProblem(compute, seed);
      expect(calc.figureSpec, `seed ${seed} 계산 약분`).toBeNull();
    }
  });

  it("생성기 fracBars 등분은 엔진 한도 안이다", () => {
    for (const seed of [1, 11, 20260821]) {
      for (const unit of UNITS) {
        const item = generateElementaryProblem(unit, seed);
        if (!item.figureSpec) continue;
        const spec = item.figureSpec as { kind?: string; cols?: number };
        if (spec.kind !== "fracBars") continue;
        expect(
          spec.cols,
          `${unit.section} seed ${seed}`,
        ).toBeGreaterThanOrEqual(2);
        expect(spec.cols, `${unit.section} seed ${seed}`).toBeLessThanOrEqual(
          16,
        );
      }
    }
  });

  it("똑같이 나누기 그림은 사탕 개수와 같은 묶음이다", () => {
    const unit = UNITS.find(
      (u) =>
        u.grade === "초3" &&
        u.chapter.includes("나눗셈") &&
        u.section.includes("똑같이"),
    )!;
    const item = generateElementaryProblem(unit, 11);
    const spec = item.figureSpec as {
      kind: string;
      groups: number;
      each: number;
    };
    expect(spec.kind).toBe("groupDots");
    // 수를 KaTeX 로 감싼 뒤에도(R1) 문장 구조는 그대로여야 한다 — 감싸기만 허용하고 자리는 못 바꾼다.
    const hit = item.content.match(/사탕 \$?(\d+)\$?개를 \$?(\d+)\$?묶음/);
    expect(hit, item.content).toBeTruthy();
    expect(spec.groups * spec.each).toBe(Number(hit![1]));
    expect(spec.groups).toBe(Number(hit![2]));
    expect(answerNumber(item.answer, unit.section)).toBe(spec.each);
  });
});

describe.skipIf(!hasEngine)("[초등 엔진] 그림 렌더", () => {
  // ⚠️ `BarScale.step` 은 우리가 적은 **선언**이고, 실제로 그려지는 걸음은 파이썬
  //    `_y_step(y_max)` 가 정한다. 두 값이 갈라지면 발문(「세로 눈금 한 칸은 $5$명」)이
  //    그림과 다른 말을 한다 — 그런데 **어느 숫자 가드도 그걸 못 본다.**
  //
  //    문턱(`≤8→1`·`≤12→2`…)을 여기 옮겨 적으면 두 곳이 같은 것을 정하게 되므로,
  //    참을 **그려진 SVG 의 눈금 간격**에서 가져온다. 그러면 파이썬이 규칙을 바꿔도
  //    이 검사는 그대로 서 있다.
  //
  //    실측 여유가 크지 않다: 걸음 5 는 `yMax ≤ 44` 까지다(`maxTop ≤ 43`). 지금 40.
  it("규모가 선언한 눈금이 실제로 그려진다", async () => {
    const bars = UNITS.filter(
      (u) => u.grade === "초4" && u.chapter.includes("막대"),
    );
    // ⚠️ **가장 큰 최댓값을 골라 그린다.** 걸음은 축 맨 위에서 갈리므로 경계는 «위»에 있다.
    //    처음엔 규모마다 «맨 처음 만난» 문항 하나를 그렸는데, `maxTop` 을 48 로 올리는
    //    변이에도 **초록이었다** — 하필 그 표본의 최댓값이 낮아 경계를 안 밟았다.
    //    픽스처가 경계를 안 가르면 가드가 아니라 장식이다.
    const worst = new Map<string, { spec: unknown; top: number }>();
    for (const unit of bars) {
      for (let i = 0; i < 120; i += 1) {
        const item = generateElementaryProblem(unit, 20260000 + i * 7);
        const scale = G4_BAR_SCALES.find((sc) => item.content.includes(sc.who));
        if (!scale) continue;
        const vals = (item.figureSpec as { values: { value: number }[] })
          .values;
        const top = Math.max(...vals.map((v) => v.value));
        if ((worst.get(scale.who)?.top ?? -1) < top) {
          worst.set(scale.who, { spec: item.figureSpec, top });
        }
      }
    }

    const checked = new Set<string>();
    const bad: string[] = [];
    for (const scale of G4_BAR_SCALES) {
      const hit = worst.get(scale.who);
      expect(hit, `${scale.who} 표본을 못 모았다`).toBeTruthy();
      if (hit) {
        checked.add(scale.who);
        const drawn = await renderFigureSpec(
          hit.spec as Record<string, unknown>,
        );
        expect(drawn.ok, drawn.ok ? "" : drawn.error).toBe(true);
        if (!drawn.ok) continue;
        // 세로축 눈금 숫자 — `text-anchor="end"` 로 축 왼쪽에 찍힌다.
        const ticks = [
          ...drawn.svg.matchAll(
            /<text[^>]*text-anchor="end"[^>]*>(\d+)<\/text>/g,
          ),
        ]
          .map((m) => Number(m[1]))
          .sort((a, b) => a - b);
        expect(
          ticks.length,
          `${scale.who}: 눈금 숫자를 못 읽었다`,
        ).toBeGreaterThan(2);
        const gaps = new Set(ticks.slice(1).map((v, k) => v - ticks[k]!));
        if (gaps.size !== 1 || !gaps.has(scale.step)) {
          bad.push(
            `${scale.who}: 선언한 눈금 ${scale.step} · 실제로 그려진 간격 [${[...gaps].join(",")}] ` +
              `(눈금 ${ticks.join(",")}) — 발문이 그림과 다른 말을 한다`,
          );
        }
      }
    }
    expect(checked.size, "규모를 하나도 못 밟았다").toBe(G4_BAR_SCALES.length);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("크기가 같은 분수 그림이 실제로 그려진다", async () => {
    const unit = UNITS.find((u) => u.section.includes("크기가 같은 분수"))!;
    const item = generateElementaryProblem(unit, 20260821);
    expect(item.figureSpec).toBeTruthy();
    const drawn = await renderFigureSpec(item.figureSpec!);
    expect(drawn.ok, drawn.ok ? "" : drawn.error).toBe(true);
  });

  it("생성기가 붙인 그림 스펙은 모두 그려진다", async () => {
    const failed: string[] = [];
    const seen = new Set<string>();
    for (const unit of UNITS) {
      const item = generateElementaryProblem(unit, 20260821);
      if (!item.figureSpec) continue;
      const kind = String((item.figureSpec as { kind?: string }).kind ?? "");
      if (seen.has(kind)) continue;
      seen.add(kind);
      const drawn = await renderFigureSpec(item.figureSpec);
      if (!drawn.ok) failed.push(`${kind} (${unit.section}): ${drawn.error}`);
    }
    expect(failed).toEqual([]);
  });

  it("후반 학년 kind 표본이 SVG 를 낸다", async () => {
    const samples: Record<string, unknown>[] = [
      {
        version: "elem-1",
        kind: "fracBars",
        cols: 7,
        rows: 4,
        filled: 8,
        fill: "#7eb89a",
      },
      { version: "elem-1", kind: "groupDots", groups: 5, each: 5 },
      {
        version: "elem-1",
        kind: "barChart",
        values: [
          { label: "가", value: 4 },
          { label: "나", value: 7 },
        ],
        yMax: 10,
      },
      {
        version: "elem-1",
        kind: "lineChart",
        values: [
          { label: "1", value: 2 },
          { label: "2", value: 5 },
        ],
      },
      {
        version: "elem-1",
        kind: "pictograph",
        unit: 5,
        items: [{ label: "가", count: 3 }],
      },
      {
        version: "elem-1",
        kind: "stripChart",
        segments: [
          { label: "가", pct: 40 },
          { label: "나", pct: 60 },
        ],
      },
      {
        version: "elem-1",
        kind: "pieChart",
        slices: [
          { label: "가", pct: 25 },
          { label: "나", pct: 75 },
        ],
      },
      { version: "elem-1", kind: "protractor", deg: 60 },
      {
        version: "elem-1",
        kind: "rotateFlip",
        cells: [
          [1, 1],
          [1, 2],
        ],
        op: "rot90",
      },
      {
        version: "elem-1",
        kind: "symmetry",
        cells: [
          [1, 1],
          [3, 1],
        ],
        axis: "v",
      },
      { version: "elem-1", kind: "symmetry", axis: "point", motif: "para" },
      {
        version: "elem-1",
        kind: "stackCubes",
        voxels: [
          [0, 0, 0],
          [0, 0, 1],
          [1, 0, 0],
        ],
        views: ["iso", "top"],
      },
      { version: "elem-1", kind: "cuboid", w: 4, d: 3, h: 2 },
      { version: "elem-1", kind: "prism", sides: 5, h: 3 },
      { version: "elem-1", kind: "pyramid", sides: 4, h: 3 },
      { version: "elem-1", kind: "cylinder", r: 2, h: 5 },
      { version: "elem-1", kind: "cone", r: 2, h: 4 },
      { version: "elem-1", kind: "sphere", r: 3 },
      { version: "elem-1", kind: "netCuboid", w: 4, d: 2, h: 3 },
      { version: "elem-1", kind: "netCylinder", r: 2, h: 5, pi: 3 },
      { version: "elem-1", kind: "areaPoly", shape: "tri", base: 8, height: 6 },
    ];
    const failed: string[] = [];
    for (const spec of samples) {
      const drawn = await renderFigureSpec(spec);
      if (!drawn.ok) failed.push(`${String(spec.kind)}: ${drawn.error}`);
      else if (!drawn.svg.includes("<svg"))
        failed.push(`${String(spec.kind)}: empty`);
    }
    expect(failed).toEqual([]);
  });

  it("원기둥 전개도 생성기는 배치를 여러 가지로 고른다", () => {
    const unit = UNITS.find((u) => u.section.includes("원기둥의 전개도"))!;
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const item = generateElementaryProblem(unit, seed);
      const spec = item.figureSpec as { kind?: string; layout?: string };
      expect(spec.kind).toBe("netCylinder");
      expect(spec.layout, `seed ${seed}`).toBeTruthy();
      layouts.add(String(spec.layout));
    }
    expect(layouts.size).toBeGreaterThanOrEqual(4);
  });

  it("세로셈은 두 자리·세 자리 viewBox 폭이 같다", async () => {
    const two = await renderFigureSpec({
      version: "elem-1",
      kind: "columnOp",
      top: "26",
      op: "×",
      bottom: "12",
    });
    const three = await renderFigureSpec({
      version: "elem-1",
      kind: "columnOp",
      top: "381",
      op: "×",
      bottom: "5",
    });
    expect(two.ok && three.ok).toBe(true);
    if (!two.ok || !three.ok) return;
    const w2 = two.svg.match(/viewBox="0 0 ([0-9.]+)/)?.[1];
    const w3 = three.svg.match(/viewBox="0 0 ([0-9.]+)/)?.[1];
    expect(w2).toBe(w3);
    expect(two.svg).toMatch(/font-size="15"/);
    expect(three.svg).toMatch(/font-size="15"/);
  });

  it("그림그래프는 칸 수와 무관하게 viewBox 폭이 240이다", async () => {
    const few = await renderFigureSpec({
      version: "elem-1",
      kind: "pictograph",
      unit: 10,
      items: [{ label: "가", count: 3 }],
    });
    const many = await renderFigureSpec({
      version: "elem-1",
      kind: "pictograph",
      unit: 10,
      items: [
        { label: "가", count: 6 },
        { label: "나", count: 4 },
      ],
    });
    expect(few.ok && many.ok).toBe(true);
    if (!few.ok || !many.ok) return;
    expect(few.svg).toMatch(/viewBox="0 0 240 /);
    expect(many.svg).toMatch(/viewBox="0 0 240 /);
  });

  it("돌리기 격자는 빈 칸·색 칸 테두리 굵기가 같다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "rotateFlip",
      cells: [
        [1, 1],
        [2, 1],
        [3, 1],
        [2, 0],
      ],
      op: "rot90",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const widths = [...r.svg.matchAll(/stroke-width="([0-9.]+)"/g)].map(
      (m) => m[1],
    );
    const cell = widths.filter((w) => w === "0.9");
    expect(cell.length).toBeGreaterThan(8);
    expect(new Set(cell).size).toBe(1);
  });

  it("띠그래프 pct 합이 100이 아니면 거부한다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "stripChart",
      segments: [
        { label: "가", pct: 40 },
        { label: "나", pct: 40 },
      ],
    });
    expect(drawn.ok).toBe(false);
  });
});
