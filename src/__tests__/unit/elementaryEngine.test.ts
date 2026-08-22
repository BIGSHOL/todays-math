/**
 * 초3-1~초6-2 소단원 전량 생성. 정답은 생성기가 같은 숫자로 계산한다.
 * 그림 스펙이 있으면 엔진이 실제로 SVG 를 낸다 — 모킹하지 않는다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FRAC_FIG_MAX, fracFigParts, fracSpec } from "@/lib/elementary/fracFig";
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
