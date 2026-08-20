/**
 * **빈 분수 되살리기 규칙** — `\frac{}{…}` 은 「분자를 잃은 것」이 아니라
 * **분수 밖에 남겨 둔 것**이다. 그래서 바깥 자료 없이 국소 수리가 된다.
 *
 * ## 왜 급한가
 *
 * 지면 전처리(`textPreprocess.cleanMalformedLatex`)가 `\frac{}{b}` 를
 * **`\frac{0}{b}` 로 바꾼다.** KaTeX parse error 를 막으려던 밴드에이드인데,
 * 들어온 자료에 대고 쓰면 **숫자를 지어낸다** — `87\frac{}{2}` 가 지면에
 * `87·0/2` 로 찍힌다. 정답은 87/2 다. 이 저장소가 여러 번 적은
 * 「그럴듯한 숫자가 □ 보다 나쁘다」의 가장 순수한 꼴이다.
 *
 * ## 두 부류 (실측 73자리 / 47행 전량을 눈으로 보고 갈랐다)
 *
 * **㉠ `\frac{}{line}` — `overline` 이 `over`+`line` 으로 쪼개진 흉터.**
 *    정본 변환기가 `overline {AB}` 를 `\frac{}{line}AB` 로 만든다(실측).
 *    선분이 **분수**가 되는데 에러가 안 난다. 되살리기는 결정적이다.
 *
 * **㉡ `<덩어리>\frac{}{분모}` — 분자가 분수 **앞**에 남았다.**
 *    `87\frac{}{2}` · `2\sqrt{5}\frac{}{5}` · `4!\frac{}{2}`.
 *    **위험한 곳은 「분자를 어디까지 끌어오나」다.** 그래서
 *    «윗자리 연산자(+ − = : × ,)가 없는 한 덩어리»일 때만 자동으로 하고,
 *    덧셈식이 앞에 오면 **손대지 않는다**(부르는 쪽이 사람 판정을 붙인다).
 *    2026-08-18 근호 사건과 같은 자리다 — 못 가르는 것은 버리는 쪽으로 둔다.
 *
 * 규칙만 여기 있다. DB 로 옮기는 배관은 `repair-empty-frac.ts` 다.
 */

/** 되살린 조각 하나. */
export interface EmptyFracFix {
  /** 무엇을 무엇으로. */
  from: string;
  to: string;
  /** 어느 규칙이. */
  rule: "overline" | "pull-numerator";
}

export interface EmptyFracResult {
  text: string;
  fixes: EmptyFracFix[];
  /** 못 고치고 남은 `\frac{}` 자리 수. 0 이 아니면 부르는 쪽이 막아야 한다. */
  left: number;
}

/**
 * ㉢ **덩어리 처음부터** 끌어오기 — «합의 한 항»이라 ㉡이 거부한 자리.
 *
 * 실측 19자리 중 12자리가 이 부류였고, **열둘 다 분자가 수식 덩어리의
 * 처음부터**였다. 그냥 그렇게 보이는 게 아니라 **본문 밖 근거로 검산**했다:
 *
 * | 문항 | 근거 |
 * | --- | --- |
 * | `HAL0208-UWT3` | α=7π/4 에서 (sinα−cosα)/tanα=√2 → 기록된 **정답 ④** |
 * | `J30503-TA3N`  | tanA=1/2 에서 값 2 → 기록된 **정답 ④** |
 * | `J10306-AYT8`  | 해설 다음 줄이 `-3a+20=-27a+27` 이다 |
 * | `HPS0302-ZDPT` | 해설 다음 줄이 `a+b+1=2m` 이다 |
 * | `J30701-Q87W`  | 합이 120, 해설이 `=12` |
 * | `HAL0212-GNR8` | cos D=−1/3 · AC²=17 · CD=2 로 (AD²−13)/(4AD) 가 맞는다 |
 *
 * ⚠️ **자동으로 켜 두지 않는다.** 이 규칙은 「어디까지가 분자인가」를 못 재고
 *    «처음부터»라고 **단정**한다. 그래서 부르는 쪽이 `wholePrefix: true` 를
 *    명시하고, 그 결과를 사람이 본 뒤에만 쓴다. 켠 채로 두면 다음에 들어올
 *    자료에서 조용히 틀린 분자를 만든다.
 */
export interface EmptyFracOptions {
  wholePrefix?: boolean;
}

/**
 * ㉠ `\frac{}{line}` 뒤에 오는 **한 덩어리**를 윗줄로 되돌린다.
 *
 * 실측 모양 둘뿐이다(21자리 전량 확인):
 *   `\frac{}{line}\mathrm{A}B\mathit{\,}` → `\overline{\mathrm{AB}}`
 *   `\frac{}{line}x`                      → `\overline{x}`
 *
 * ⚠️ `\mathit{…}` 은 **비어 있거나 공백뿐**일 때만 삼킨다. `it` 뒤에 진짜
 *    값이 붙은 것(`\mathit{9}`)까지 지우면 **수를 잃는다.**
 */
const OVERLINE_LABEL =
  /\\frac\{\}\{line\}\\mathrm\{([A-Za-z]{1,3})\}([A-Za-z]?)(?:\\mathit\{[\s,\\]*\})?/g;
const OVERLINE_BARE = /\\frac\{\}\{line\}([A-Za-z])(?![A-Za-z{])/g;

/**
 * `\frac{}{` 뒤 분모를 **괄호 짝을 세어** 읽는다.
 *
 * 정규식으로 한 겹만 보면 `\frac{}{\left( \frac{\sqrt{3}}{2}\right)}` 같은
 * 두 겹 중첩을 **아예 못 본다** — 2026-08-18 에 보호 정규식이 `[^{}]*` 라
 * `\mathrm{\overline{GE}}` 를 못 봐서 두 행을 망친 자리와 같다.
 */
function readEmptyFrac(
  text: string,
  from: number,
): { at: number; end: number; denom: string } | null {
  const at = text.indexOf("\\frac{}{", from);
  if (at < 0) return null;
  const open = at + "\\frac{}{".length;
  let depth = 1;
  let i = open;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { at, end: i + 1, denom: text.slice(open, i) };
    }
    i++;
  }
  return null;
}

/**
 * ㉡ 분수 **앞**에 남은 분자를 끌어온다.
 *
 * 끌어올 수 있는 것은 «윗자리 연산자가 없는 한 덩어리»뿐이다. 왼쪽으로 읽으며
 * 아래를 모은다:
 *   · 닫는 괄호로 끝나면 짝이 맞는 데까지          `(2+\sqrt{2})`
 *   · `}` 로 끝나면 짝이 맞는 데까지 + 그 앞 명령   `\sqrt{10}` · `\mathrm{AD}`
 *   · 숫자·글자·`!`·`^{…}`·`_{…}`                  `87` · `4!` · `x^{2}`
 * 그러다 `+ - = : , × ÷ < > ~ $` 를 만나면 **거기서 멈춘다.** 멈춘 자리가
 * 덩어리의 시작이고, 아무것도 못 모았으면 **고치지 않는다.**
 */
function pullNumerator(text: string, at: number): { start: number } | null {
  let i = at;
  let took = false;
  // 🔴 덩어리를 다 모은 **뒤**에 「무엇 때문에 멈췄나」를 본다. `+`·`-` 에서
  //    멈췄다면 그 덩어리는 **더 큰 합의 한 항**이라 분자가 어디까지인지 모른다.
  //    거기서 그냥 한 항만 끌어오면 평균 `120/10` 이 `…+4/10` 이 된다 —
  //    에러가 안 나는 **틀린 값**이다. 그런 자리는 사람에게 넘긴다.
  //    (다만 덩어리 앞이 곧 수식의 시작이면 그 `-` 는 홑부호다 — 끌어온다.)
  const 합의항 = (stop: number): boolean => {
    const c = text[stop - 1];
    if (c !== "+" && c !== "-" && c !== "±") return false;
    return text.slice(0, stop - 1).trim() !== "";
  };
  for (;;) {
    // 덩어리 사이 공백은 넘긴다 — 단, 아무것도 못 모은 채로는 안 넘긴다.
    while (i > 0 && text[i - 1] === " ") i--;
    if (i <= 0) break;
    const c = text[i - 1]!;
    if (c === "}") {
      let depth = 0;
      let j = i;
      while (j > 0) {
        const d = text[j - 1]!;
        if (d === "}") depth++;
        else if (d === "{") {
          depth--;
          if (depth === 0) {
            j--;
            break;
          }
        }
        j--;
      }
      if (depth !== 0) return null; // 짝이 안 맞는다 — 손대지 않는다
      // `{…}` 앞의 명령(`\sqrt`)이나 위/아래 첨자 표시까지 함께 삼킨다.
      let k = j;
      const before = text.slice(0, k);
      const cmd = /\\[A-Za-z]+$/.exec(before);
      if (cmd) k = before.length - cmd[0].length;
      else if (before.endsWith("^") || before.endsWith("_"))
        k = before.length - 1;
      i = k;
      took = true;
      continue;
    }
    if (/[0-9A-Za-z!]/.test(c)) {
      i--;
      took = true;
      continue;
    }
    if (c === ")") {
      let depth = 0;
      let j = i;
      while (j > 0) {
        const d = text[j - 1]!;
        if (d === ")") depth++;
        else if (d === "(") {
          depth--;
          if (depth === 0) {
            j--;
            break;
          }
        }
        j--;
      }
      if (depth !== 0) return null;
      i = j;
      took = true;
      continue;
    }
    if (c === "\\") {
      // `\pi` 같은 홑명령은 위 글자 갈래에서 이미 먹혔고 여기 남은 `\` 를 삼킨다.
      i--;
      took = true;
      continue;
    }
    break; // + - = : , × 등 — 여기서 멈춘다
  }
  if (!took) return null;
  if (i >= at) return null;
  if (합의항(i)) return null;
  return { start: i };
}

export function fixEmptyFrac(
  input: string,
  options: EmptyFracOptions = {},
): EmptyFracResult {
  const fixes: EmptyFracFix[] = [];
  let text = input;

  text = text.replace(OVERLINE_LABEL, (whole, a: string, b: string) => {
    const to = `\\overline{\\mathrm{${a}${b}}}`;
    fixes.push({ from: whole, to, rule: "overline" });
    return to;
  });
  text = text.replace(OVERLINE_BARE, (whole, a: string) => {
    const to = `\\overline{${a}}`;
    fixes.push({ from: whole, to, rule: "overline" });
    return to;
  });

  // ㉡ — 한 번에 하나씩, 왼쪽부터. 고칠 때마다 문자열이 바뀌므로 다시 찾는다.
  // 못 고치는 자리를 만나면 **건너뛰고 다음 자리**를 본다 — 멈춰 버리면
  // 같은 행의 뒤쪽 멀쩡한 자리까지 못 고친다.
  let from = 0;
  for (let guard = 0; guard < 40; guard++) {
    const f = readEmptyFrac(text, from);
    if (!f) break;
    let pulled = pullNumerator(text, f.at);
    if (!pulled && options.wholePrefix) {
      // ㉢ — 덩어리 처음부터. 앞에 윗자리 관계(`=` `:`)가 있으면 그 **뒤**부터다.
      const prefix = text.slice(0, f.at);
      const rel = Math.max(prefix.lastIndexOf("="), prefix.lastIndexOf(":"));
      const start = rel >= 0 ? rel + 1 : 0;
      const cand = prefix.slice(start);
      // 🔴 2차 방어 — 부르는 쪽이 손 표로 켠 자리만 온다는 전제이지만, 표가
      //    새면 **그럴듯한 헛것**이 나온다. 실측: `lim t→1(\frac{}{t^2-1}` 에
      //    이 규칙을 대면 `\frac{t→1(}{t^2-1}` 가 된다 — 뜻이 없는데 에러도
      //    안 난다. 분자가 될 수 없는 모양이면 여기서 막는다.
      const 분자가아니다 =
        /[→⟶]|\\to\b|\\lim\b|\\rightarrow\b|\(\s*$|[+\-*/^_,]\s*$/.test(cand);
      if (cand.trim() !== "" && !분자가아니다) pulled = { start };
    }
    if (!pulled) {
      from = f.at + 1;
      continue;
    }
    const num = text.slice(pulled.start, f.at);
    const to = `\\frac{${num}}{${f.denom}}`;
    fixes.push({
      from: num + text.slice(f.at, f.end),
      to,
      rule: "pull-numerator",
    });
    text = text.slice(0, pulled.start) + to + text.slice(f.end);
    from = pulled.start + to.length;
  }

  const left = (text.match(/\\frac\{\}/g) ?? []).length;
  return { text, fixes, left };
}
