/**
 * 🔴 RED — T7.14 '오늘의 시험' 화면 (계기판 · 회차 상세).
 *
 * 이 테스트가 있는 이유:
 * 확정 시안(docs/design/mockups/hifi-t70-todays-exam.html · 05 §8.7 D-39~D-44)이 화면에
 * **말로 병기하라**고 못박은 것들 — 신뢰도 단계·파이프라인 단계·예측 구간·잔차 — 은 전부
 * 색으로도 표현된다. 색은 리팩터링 중 조용히 사라져도 테스트가 안 잡는다. 그래서 여기서는
 * **문자열(말)**을 검증한다. 색이 빠지면 눈에 띄지만, 말이 빠지면 색맹 사용자에게 화면이
 * 통째로 침묵하기 때문이다(05 §5 접근성).
 *
 * 그리고 이 기능의 최대 위험은 근거 없는 확신이다. 근거 회차가 부족한 03행이 큰 숫자를
 * 내지 않고 "예측 불가"를 명시하는지가 이 파일의 핵심 회귀 기준이다.
 *
 * 데이터: src/mocks/handlers/prediction.ts (MSW). T7.7/T7.10 실 API 는 아직 없고,
 * 계약(src/contracts/predictor.contract.ts)이 SSOT라 나중에 그대로 갈아끼운다.
 */
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { server } from "@/mocks/server";

import ExamPage from "@/app/(main)/exam/page";
import { RoundDetail } from "@/components/exam/RoundDetail";
import {
  MOCK_DETAIL_JEONGHWA,
  MOCK_DETAIL_JEONGHWA_PAST,
  ROUND_DAERYUN_ID,
  ROUND_GYEONGMYEONG_ID,
  ROUND_JEONGHWA_ID,
  ROUND_JEONGHWA_PAST_ID,
} from "@/mocks/data/predictions";

/** 시안 기준일 — D-day 가 흔들리지 않게 Date 만 고정한다(타이머는 실물 유지). */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 15, 9, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderDashboard() {
  const view = render(<ExamPage />);
  await screen.findByRole("article", { name: /정화중 3학년 · 25-2 중간/ });
  return view;
}

async function renderDetail(roundId: string) {
  const view = render(<RoundDetail roundId={roundId} />);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

// ─────────────────────────────────────────────
// 계기판 (D-39)
// ─────────────────────────────────────────────
describe("오늘의 시험 계기판", () => {
  it("워드마크가 두 제품으로 갈리고 '오늘의시험' 쪽이 현재 탭이다 (D-39)", async () => {
    await renderDashboard();

    // 선택된 쪽은 링크가 아니라 현재 위치 표시다.
    expect(screen.getByText("오늘의시험")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // 반대쪽은 '오늘의 수학'으로 건너가는 링크여야 한다.
    expect(screen.getByRole("link", { name: "오늘의수학" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("회차마다 큰 순번과 D-day 를 세운다", async () => {
    await renderDashboard();

    const first = screen.getByRole("article", {
      name: /정화중 3학년 · 25-2 중간/,
    });
    expect(within(first).getByText("01")).toBeInTheDocument();
    expect(within(first).getByText("D-14")).toBeInTheDocument();

    const second = screen.getByRole("article", {
      name: /경명여중 2학년 · 25-2 중간/,
    });
    expect(within(second).getByText("02")).toBeInTheDocument();
    expect(within(second).getByText("D-21")).toBeInTheDocument();
  });

  it("근거 회차 수와 신뢰도를 행에 그대로 노출한다 (D-39 핵심 계약)", async () => {
    await renderDashboard();

    const first = screen.getByRole("article", {
      name: /정화중 3학년 · 25-2 중간/,
    });
    expect(within(first).getByText("신뢰도 보통 0.62")).toBeInTheDocument();
    expect(within(first).getByText("근거 4회차")).toBeInTheDocument();

    const second = screen.getByRole("article", {
      name: /경명여중 2학년 · 25-2 중간/,
    });
    expect(within(second).getByText("신뢰도 높음 0.81")).toBeInTheDocument();
    expect(within(second).getByText("근거 6회차")).toBeInTheDocument();
  });

  it("4단계 파이프라인을 말로 적는다 — 색만 쓰지 않는다 (D-42)", async () => {
    await renderDashboard();

    const first = screen.getByRole("article", {
      name: /정화중 3학년 · 25-2 중간/,
    });
    expect(within(first).getByText("청사진")).toBeInTheDocument();
    expect(within(first).getByText("문제지")).toBeInTheDocument();
    expect(within(first).getByText("채점 2/4")).toBeInTheDocument();
    expect(within(first).getByText("실점수 대기")).toBeInTheDocument();
  });

  it("근거가 부족한 회차는 큰 숫자 대신 '예측 불가'를 명시한다", async () => {
    await renderDashboard();

    const weak = screen.getByRole("article", {
      name: /대륜고 1학년 · 25-2 기말/,
    });
    expect(within(weak).getByText("신뢰도 낮음 0.18")).toBeInTheDocument();
    expect(within(weak).getByText("예측 불가 — 근거 부족")).toBeInTheDocument();
    // 권장하지 않는 회차에 '지금 할 일'을 지정하지 않는다.
    expect(within(weak).queryByText("청사진 만들기")).not.toBeInTheDocument();
  });

  it("신뢰도 인셋 바에 블루를 쓰지 않는다 (D-44)", async () => {
    const { container } = await renderDashboard();

    const bars = container.querySelectorAll("[data-confidence-bar]");
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.getAttribute("data-confidence-bar")).not.toBe("blue");
    }
    expect(
      Array.from(bars).map((b) => b.getAttribute("data-confidence-bar")),
    ).toEqual(["yellow", "green", "red", "green"]);
  });

  it("행 본체는 누를 수 없고, 회차로 들어가는 링크만 컨트롤이다 (D-30)", async () => {
    await renderDashboard();

    const first = screen.getByRole("article", {
      name: /정화중 3학년 · 25-2 중간/,
    });
    expect(first).not.toHaveAttribute("onclick");
    expect(first.className).not.toMatch(/cursor-pointer/);
    expect(first.className).not.toMatch(/hover:bg-/);

    const link = within(first).getByRole("link", {
      name: "정화중 3학년 · 25-2 중간",
    });
    expect(link).toHaveAttribute("href", `/exam/${ROUND_JEONGHWA_ID}`);
  });
});

// ─────────────────────────────────────────────
// 회차 상세 (D-40)
// ─────────────────────────────────────────────
describe("회차 상세 — 예측 | 실측 좌우 대조", () => {
  it("예측과 실측을 같은 항목으로 나란히 적는다", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    const predicted = screen.getByRole("region", { name: "예측" });
    expect(within(predicted).getByText("24문항 / 100점")).toBeInTheDocument();
    expect(within(predicted).getByText("객18 단2 서4")).toBeInTheDocument();
    expect(within(predicted).getByText("하9 중11 상4")).toBeInTheDocument();

    const observed = screen.getByRole("region", { name: "실측" });
    expect(within(observed).getByText("25문항 / 100점")).toBeInTheDocument();
    expect(within(observed).getByText("객18 단1 서6")).toBeInTheDocument();
    expect(within(observed).getByText("하7 중12 상6")).toBeInTheDocument();
  });

  it("시험 전에는 실측이 비어 있는 것이 정상 상태임을 적는다", async () => {
    await renderDetail(ROUND_JEONGHWA_ID);

    const observed = screen.getByRole("region", { name: "실측" });
    expect(
      within(observed).getByText("실측 없음 — 시험 전입니다"),
    ).toBeInTheDocument();
  });

  it("예상 점수를 점이 아니라 구간으로 적는다 (D-40)", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    const row = screen.getByRole("row", { name: /이서준/ });
    expect(within(row).getByText("88")).toBeInTheDocument();
    expect(within(row).getByText("80~93")).toBeInTheDocument();
  });

  it("잔차를 적중/빗나감이라는 말과 함께 적는다 (D-42)", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    expect(
      within(screen.getByRole("row", { name: /이서준/ })).getByText("+3 적중"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /김하윤/ })).getByText(
        "−13 빗나감",
      ),
    ).toBeInTheDocument();
  });

  it("미응시 학생은 숫자를 만들지 않는다", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    const row = screen.getByRole("row", { name: /박지호/ });
    expect(within(row).getByText("미응시")).toBeInTheDocument();
    expect(within(row).queryByText(/~/)).not.toBeInTheDocument();
  });

  it("응답 표본이 부족한 학생은 예상 점수를 띄우지 않는다", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    const row = screen.getByRole("row", { name: /최수아/ });
    expect(within(row).getByText("예측 불가 — 응답 부족")).toBeInTheDocument();
  });

  it("근거가 부족한 회차는 청사진 숫자를 내지 않고 예측 불가를 알린다", async () => {
    await renderDetail(ROUND_DAERYUN_ID);

    const predicted = screen.getByRole("region", { name: "예측" });
    expect(
      within(predicted).getByText("예측 불가 — 근거 부족"),
    ).toBeInTheDocument();
    expect(
      within(predicted).getByText("근거 1회차 · 신뢰도 낮음 0.18"),
    ).toBeInTheDocument();
    expect(within(predicted).queryByText(/문항 \/ /)).not.toBeInTheDocument();
  });

  it("엔진 버전과 근거 회차를 밝힌다 — 지표를 섞어 보지 않기 위함", async () => {
    await renderDetail(ROUND_JEONGHWA_PAST_ID);

    expect(screen.getByText("엔진 v0.4 · 근거 3회차")).toBeInTheDocument();
  });

  it("목록으로 돌아가는 링크가 있다", async () => {
    await renderDetail(ROUND_GYEONGMYEONG_ID);

    expect(screen.getByRole("link", { name: "목록" })).toHaveAttribute(
      "href",
      "/exam",
    );
  });
});

// ─────────────────────────────────────────────
// 빈 상태 · 오류 상태
//
// 실 API(/api/exam/rounds)는 실측이 아직 0건이라 **당분간 대부분 빈 배열을 낸다.**
// 그 상태에서 화면이 무너지거나(빈 화면) 숫자를 지어내면 첫날부터 신뢰를 잃는다.
// ─────────────────────────────────────────────
describe("데이터가 없을 때", () => {
  it("회차가 0건이면 무너지지 않고 이유를 적는다", async () => {
    server.use(
      http.get("/api/exam/rounds", () => HttpResponse.json({ data: [] })),
    );

    render(<ExamPage />);

    expect(
      await screen.findByText(
        "아직 회차가 없습니다. 예측을 실행하면 여기에 쌓입니다.",
      ),
    ).toBeInTheDocument();
    // 크롬은 그대로 서 있어야 한다 — 탭을 잃으면 돌아갈 길이 없다.
    expect(
      screen.getByRole("link", { name: "오늘의수학" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  /**
   * 🔴 학생 표가 빌 때 **사유가 둘**이다. 하나로 뭉개면 원장님이 엉뚱한 곳을 고친다.
   *
   * 실 엔진은 오늘 학생별 예상 점수를 내지 못한다(`predictedScores: []`). 그때 표에
   * "이 회차에 배정된 학생이 없습니다" 라고 적으면, 학생이 멀쩡히 등록된 반에서도
   * 원장님이 반 편성을 의심하게 된다 — 원인은 반이 아니라 엔진이다.
   */
  it("🔴 학생별 예측이 0명이면 반 탓으로 돌리지 않고 엔진 쪽 사유를 적는다", async () => {
    render(<RoundDetail roundId={ROUND_DAERYUN_ID} />);

    expect(
      await screen.findByText(
        "학생별 예상 점수는 아직 내지 않습니다. 회차 단위 청사진만 있습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("이 회차에 배정된 학생이 없습니다"),
    ).not.toBeInTheDocument();
  });

  it("예측은 냈는데 대상이 내 학생이 아니면 그렇게 적는다", async () => {
    server.use(
      http.get("/api/exam/rounds/:id", () =>
        HttpResponse.json({
          data: {
            ...MOCK_DETAIL_JEONGHWA,
            students: [],
            predictedStudentCount: 4,
          },
        }),
      ),
    );

    render(<RoundDetail roundId={ROUND_JEONGHWA_ID} />);

    expect(
      await screen.findByText("이 회차의 예측 대상 중 내 학생이 없습니다"),
    ).toBeInTheDocument();
  });

  /**
   * 로컬 dev 로 띄워 보고 발견한 회귀 — 실측 청사진 컬럼이 아직 없어(T7.10 범위)
   * **실점수만 먼저 들어오는 상태**가 실제로 난다. 그때 "시험 전입니다"라고 적으면
   * 이미 친 시험을 안 쳤다고 말하는 셈이다.
   */
  it("실점수가 들어왔으면 실측 칸이 '시험 전'이라고 하지 않는다", async () => {
    server.use(
      http.get("/api/exam/rounds/:id", () =>
        HttpResponse.json({
          data: {
            ...MOCK_DETAIL_JEONGHWA_PAST,
            observedBlueprint: null,
          },
        }),
      ),
    );

    render(<RoundDetail roundId={ROUND_JEONGHWA_PAST_ID} />);
    await screen.findByRole("heading", { level: 1 });

    const observed = screen.getByRole("region", { name: "실측" });
    expect(
      within(observed).getByText("실측 청사진 없음 — 실점수만 들어왔습니다"),
    ).toBeInTheDocument();
    expect(
      within(observed).queryByText("실측 없음 — 시험 전입니다"),
    ).not.toBeInTheDocument();
  });

  it("회차 조회가 404면 상세가 안내를 적는다", async () => {
    server.use(
      http.get("/api/exam/rounds/:id", () =>
        HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "회차를 찾을 수 없습니다." } },
          { status: 404 },
        ),
      ),
    );

    render(<RoundDetail roundId={ROUND_JEONGHWA_ID} />);

    expect(
      await screen.findByText("회차를 불러오지 못했습니다"),
    ).toBeInTheDocument();
  });
});
