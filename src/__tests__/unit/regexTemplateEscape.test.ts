/**
 * 🔴 발견기 — **`new RegExp(\`…\`)` 안의 역슬래시가 조용히 죽는다.**
 *
 * 2026-08-19 에 원문자 목록을 한 곳으로 모으며 정규식 열한 개를 문자열 리터럴에서
 * 템플릿 리터럴로 옮겼다. 그때 **`\s` 가 `s` 로 죽었다** — 템플릿 리터럴은
 * `\s` 를 「알 수 없는 이스케이프」로 보고 백슬래시를 버린다.
 *
 * ## 왜 이 검사가 필요한가 — **같은 버그가 한쪽만 시끄럽다**
 *
 * | 죽은 것 | 결과 | 테스트가 잡았나 |
 * | --- | --- | :-: |
 * | `\s` → `s` | `«③, ⑤»` 가 객관식이 아니게 된다 | **잡았다** (2건 빨강) |
 * | `\n` → 진짜 개행 | 정규식에서 **개행에 그대로 매치된다** | ❌ 안 잡힌다 |
 * | `\t` → 진짜 탭 | `[ \t]` 가 `[ <탭>]` 이 되어 **똑같이 동작한다** | ❌ 안 잡힌다 |
 *
 * 즉 이 결함은 **절반이 침묵한다.** 오늘은 우연히 동작이 같았지만, 다음에 누가
 * `\d`·`\b`·`\w` 를 같은 방식으로 쓰면 조용히 다른 것을 매치한다.
 * 그래서 **동작이 아니라 «모양»을 검사한다** — `String.raw` 를 안 쓴 채
 * 이스케이프가 든 템플릿 정규식은 존재 자체가 결함이다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SCAN = ["src", "scripts"];
const EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

/**
 * `new RegExp(` 뒤에 오는 **백틱 리터럴**만 본다. `String.raw` 가 붙어 있으면 안전하다.
 * 백슬래시가 **둘**이면(`\s`) 그것도 안전하다 — 템플릿이 하나로 줄여 준다.
 */
const RISKY = /new RegExp\(\s*(?:\/\/[^\n]*\n\s*)*`([^`]*)`/g;
/**
 * 홀수 개 백슬래시 뒤의 글자 = 템플릿이 삼켜 버리는 이스케이프.
 *
 * ⚠️ 정규식으로 «홀수»를 세려다 처음에 **거꾸로 걸렸다** — 안전한 `\s`(둘)까지
 * 잡아 무고한 11곳을 결함으로 찍었다. 세는 것은 세는 코드로 센다.
 */
/**
 * **안전한 쪽을 나열한다** — 위험한 쪽이 아니라. 목록에 없는 것은 막는다.
 *
 * 템플릿 리터럴이 만드는 글자와 정규식이 그 이스케이프에 주는 뜻이 **같은** 것들이다:
 * `\n`→개행, `\t`→탭, `\r`·`\v`·`\f`, `\uXXXX`·`\xXX` 는 둘 다 그 글자다.
 *
 * 나머지는 전부 뜻이 달라진다. 특히:
 * - `\s`·`\d`·`\w`·`\S`·`\D`·`\W`·`\p`·`\P` → 템플릿이 **백슬래시를 버려**
 *   그냥 글자 `s`·`d`·`w`… 가 된다. (2026-08-19 에 실제로 이렇게 죽었다.)
 * - `\b` → 템플릿이 **백스페이스 문자(U+0008)** 를 만든다. 단어 경계가 조용히
 *   사라지고 **글자가 하나 생긴다** — 가장 나쁜 부류다.
 * - `\c` → 정규식은 제어문자 이스케이프인데 템플릿은 그냥 `c` 다.
 */
const SAFE_ESCAPE = new Set(["n", "t", "r", "v", "f", "u", "x"]);

function swallowsEscape(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") continue;
    let run = 0;
    while (body[i + run] === "\\") run++;
    const next = body[i + run];
    if (run % 2 === 1 && next !== undefined && !SAFE_ESCAPE.has(next))
      return true;
    i += run - 1;
  }
  return false;
}

describe("정규식 템플릿 리터럴에서 이스케이프가 죽지 않는다", () => {
  it("`new RegExp(\`…\`)` 에 홀수 백슬래시가 없다 — 있으면 `String.raw` 를 붙여라", () => {
    const offenders: string[] = [];
    for (const root of SCAN) {
      for (const file of walk(path.join(ROOT, root))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(RISKY)) {
          // `String.raw` 가 붙은 것은 이 정규식이 애초에 안 잡는다(백틱 앞이 다르다).
          if (swallowsEscape(m[1]!)) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(
              `${path.relative(ROOT, file)}:${line}  ${m[1]!.slice(0, 60)}`,
            );
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
