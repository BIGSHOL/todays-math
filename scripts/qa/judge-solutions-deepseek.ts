/**
 * 생성 해설 교차 판정 — DeepSeek (2026-08-22).
 *
 *   npx tsx --env-file=.env scripts/qa/judge-solutions-deepseek.ts <프롬프트> <판정팩> <출력>
 *
 * 판정팩: 번호 매긴 문제+해설 목록 (정답은 넣지 않는다 — 판정자도 독립 검산).
 *
 * 🔴 판정자를 믿기 전에 **눈금**부터 (2026-08-20 교훈):
 *  · 양성 대조 — 일부러 틀리게 조작한 해설 1건을 심어 잡는지 본다.
 *  · 음성 대조 — 멀쩡한 해설에 트집(지어냄)이 없는지 본다.
 *  파일럿(2026-08-22): codex·DeepSeek 둘 다 심은 함정만 정확히 잡고 지어냄 0.
 *  codex 판은 `cat <프롬프트+팩> | timeout 900 codex exec --skip-git-repo-check`.
 */
import { readFileSync, writeFileSync } from "node:fs";

import OpenAI from "openai";

async function main() {
  const [promptFile, packFile, outFile] = process.argv.slice(2);
  if (!promptFile || !packFile || !outFile)
    throw new Error(
      "사용법: judge-solutions-deepseek.ts <프롬프트> <판정팩> <출력>",
    );
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: "https://api.deepseek.com",
  });
  const prompt =
    readFileSync(promptFile, "utf8") + readFileSync(packFile, "utf8");
  const res = await client.chat.completions.create({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 32000,
  });
  const out = res.choices[0]?.message?.content ?? "";
  writeFileSync(outFile, out, "utf8");
  console.log(
    "finish:",
    res.choices[0]?.finish_reason,
    "| 판정 줄:",
    (out.match(/^\d+ (OK|결함)/gm) ?? []).length,
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
