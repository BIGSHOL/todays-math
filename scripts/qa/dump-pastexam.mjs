import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const db = new PrismaClient();
const FIG=/(그림|그래프|도형|산점도|상자그림)/;
const rows = await db.problem.findMany({
  where: { source: "past_exam" },
  select: { id:true, content:true, answer:true },
});
const damaged = rows.filter(r => /정답 없음/.test(r.answer) && !FIG.test(r.content));
writeFileSync("scripts/qa/reports/pastexam-dump.json", JSON.stringify({
  all: rows.map(r=>({id:r.id, content:r.content})),
  damaged: damaged.map(r=>({id:r.id, content:r.content})),
}), "utf8");
console.log("past_exam", rows.length, "| damaged(no-figure, no-answer)", damaged.length);
await db.$disconnect();
