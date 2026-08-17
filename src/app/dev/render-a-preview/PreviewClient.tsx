"use client";

import { useState } from "react";

import { AppChrome } from "@/components/chrome/AppChrome";
import { PROBLEM_CARD_MIN_WIDTH } from "@/components/print/tokens";
import {
  FieldSelect,
  FIELD_SELECT_WIDTH,
} from "@/components/problem/FieldSelect";
import { ProblemCard } from "@/components/problem/ProblemCard";
import { Button } from "@/components/ui/Button";

import { PREVIEW_PROBLEMS } from "./fixtures";
import {
  CHAPTER_OPTIONS,
  GRADE_OPTIONS,
  SECTION_COLLIDING,
  SECTION_OPTIONS,
} from "./options";
import styles from "./renderAPreview.module.css";

const FILTER_GRID_STYLE = {
  gridTemplateColumns: `repeat(auto-fill, ${FIELD_SELECT_WIDTH})`,
};

const GRID_STYLE = {
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${PROBLEM_CARD_MIN_WIDTH}), 1fr))`,
};

const TONES = [
  { key: "C", label: "안 C — 카드 바탕 그대로 (현재 적용)", className: "" },
  { key: "A", label: "안 A — 수리 전(크림 상자)", className: styles.toneA },
  {
    key: "B",
    label: "안 B — 카드 전체를 지면 크림으로",
    className: styles.toneB,
  },
] as const;

type ToneKey = (typeof TONES)[number]["key"];

/**
 * 렌더 수리 A 시안 화면 — 원장님 확인용(D-07).
 *
 * 실데이터 없이도 문제은행 배치를 그대로 볼 수 있게 대표 본문 8종을 박아 둔다:
 * 짧은 문항 / 보기 5개(열 안에서 접히는 경우) / 긴 인라인 수식 / 큰 연산자 /
 * 보기 4개 / 서술형 / **한 덩어리라 줄바꿈이 안 되는 긴 분수** / 곱셈으로 끊기는 긴 식.
 *
 * 소단원 select 의 옵션은 실제 시드(725종)에서 길이 분위수로 뽑았고,
 * 앞 14글자가 겹치는 실제 짝도 넣었다 — 말줄임이 구분을 지우는지 눈으로 보려는 것.
 */
export function PreviewClient() {
  const [tone, setTone] = useState<ToneKey>("C");
  const [section, setSection] = useState("");
  const toneClass = TONES.find((item) => item.key === tone)?.className ?? "";

  return (
    <AppChrome>
      <main className={`px-[26px] py-6 ${toneClass}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-[15px] font-black">문제은행</h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="ink">등록</Button>
            <Button>생성</Button>
            <Button variant="secondary">변형</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border border-dashed border-[#C2C2C0] p-3">
          <span className="text-[10.5px] font-black tracking-[1.5px] text-[#6A6A68]">
            시안 · 지면 톤
          </span>
          {TONES.map((item) => (
            <Button
              key={item.key}
              variant={item.key === tone ? "ink" : "secondary"}
              aria-pressed={item.key === tone}
              onClick={() => setTone(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div
          className="mt-4 grid gap-3"
          style={FILTER_GRID_STYLE}
          data-preview-filters
        >
          <FieldSelect label="학년" defaultValue="">
            <option value="">전체</option>
            {GRADE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect label="학기" defaultValue="">
            <option value="">전체</option>
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </FieldSelect>
          <FieldSelect label="중단원" defaultValue="">
            <option value="">전체</option>
            {CHAPTER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect
            label="소단원"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          >
            <option value="">전체</option>
            {[...SECTION_OPTIONS, ...SECTION_COLLIDING].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect label="난이도" defaultValue="">
            <option value="">전체</option>
            <option value="easy">쉬움</option>
            <option value="mid">보통</option>
            <option value="hard">어려움</option>
          </FieldSelect>
          <FieldSelect label="유형" defaultValue="">
            <option value="">전체</option>
            <option value="계산">계산</option>
            <option value="개념">개념</option>
            <option value="활용">활용</option>
            <option value="서술형">서술형</option>
          </FieldSelect>
          <FieldSelect label="상태" defaultValue="">
            <option value="">전체</option>
            <option value="pending">대기</option>
            <option value="approved">승인</option>
            <option value="rejected">반려</option>
          </FieldSelect>
        </div>

        <section
          className="mt-4 grid items-start gap-6 print:block"
          style={GRID_STYLE}
          data-preview-list
        >
          {PREVIEW_PROBLEMS.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </section>
      </main>
    </AppChrome>
  );
}
