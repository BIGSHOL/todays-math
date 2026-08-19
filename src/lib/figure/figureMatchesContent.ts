/**
 * 「AI 가 도형에 **본문에 없는 값**을 지어 넣었는가」를 판정한다.
 *
 * ## 왜 필요한가 — 프롬프트로는 못 막았다
 *
 * 프롬프트(v3)는 「본문만으로 확정할 수 없으면 반드시 null, **지어내지 마십시오**」라고
 * 시킨다. 그런데 2026-08-19 실측에서 그대로 어겼다:
 *
 *   원본  «반지름의 길이가 9cm 인 원에서 **색칠한 부분**의 넓이를 구하시오»
 *   도형  원 하나 + `35°` `45°` `25°` `15°` + A·B·C·D·E·O
 *
 * 35°·45°·25°·15° 는 본문 어디에도 없다. 게다가 그 스펙은 엔진을 **성공적으로 통과**했다 —
 * 그럴듯하게 그려진 오답이다. 이 저장소가 여러 번 만난 부류다(KaTeX 가 초록이라고 지면이
 * 멀쩡한 게 아니다, 2026-08-16). **엔진이 그렸다는 것은 「옳다」가 아니라 「모양이 맞다」다.**
 *
 * ## 열쇠
 *
 * 좌표는 보지 않는다 — 그건 배치이지 주장이 아니다. **글자로 찍히는 값**(치수·각도·라벨)만
 * 본다. 지면에 숫자로 찍히는 것은 학생이 그대로 읽고 푸는 값이라, 본문에 근거가 없으면
 * 그 자체로 틀린 문항이다.
 *
 * 완전하지 않다 — 본문에 있는 숫자만 써서 엉뚱하게 배치하면 이 검사는 통과한다.
 * 그래도 **실측으로 관측된 실패 모드**는 막는다. 못 막는 쪽은 원장님이 미리보기에서
 * 도형을 눈으로 보고 거른다(그래서 채택 전에 그려서 보여 준다).
 */

/** 숫자만 뽑는다. `12 cm` · `$12cm$` · `35°` 가 모두 같은 열쇠(12, 35)로 떨어진다. */
function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 스펙 안에서 **글자로 찍히는 값**만 모은다.
 *
 * · `dimensions.*.label` — 치수선에 찍히는 값
 * · `angles.*.label`     — 각도 표시에 찍히는 값
 * · `labels.*`           — 점 이름(문자열이거나 `{text}`)
 *
 * `points`/`circles`/`segments` 의 숫자는 **좌표·반지름**이라 지면에 안 찍힌다. 보지 않는다.
 */
function printedLabels(spec: Record<string, unknown>): string[] {
  const out: string[] = [];

  const pushLabel = (value: unknown) => {
    if (typeof value === "string") out.push(value);
  };

  for (const key of ["dimensions", "angles"]) {
    const group = spec[key];
    if (group === null || typeof group !== "object") continue;
    for (const item of Object.values(group as Record<string, unknown>)) {
      if (item !== null && typeof item === "object") {
        pushLabel((item as Record<string, unknown>).label);
      }
    }
  }

  const labels = spec.labels;
  if (labels !== null && typeof labels === "object") {
    for (const item of Object.values(labels as Record<string, unknown>)) {
      if (typeof item === "string") pushLabel(item);
      else if (item !== null && typeof item === "object") {
        pushLabel((item as Record<string, unknown>).text);
      }
    }
  }

  return out;
}

/**
 * 지어낸 값이 있으면 **사유 문구**를, 없으면 `null` 을 돌려준다.
 * 문구는 그대로 화면에 나가므로 원장님이 무엇이 문제인지 바로 읽게 쓴다.
 *
 * `content` 는 **변형본의 본문**이다(원본이 아니다) — 도형은 변형된 숫자를 실어야 하고,
 * 원본과 대면 바뀐 숫자가 전부 「지어낸 값」으로 잡힌다.
 */
export function figureFabricationReason(
  spec: Record<string, unknown>,
  content: string,
): string | null {
  const inContent = new Set(numbersIn(content));
  const invented = new Set<string>();

  for (const label of printedLabels(spec)) {
    for (const n of numbersIn(label)) {
      if (!inContent.has(n)) invented.add(n);
    }
  }

  if (invented.size === 0) return null;
  return `도형에 본문에 없는 값이 들어 있습니다 (${[...invented].join(", ")}) — AI 가 지어낸 도형입니다.`;
}
