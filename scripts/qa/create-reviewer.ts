/**
 * 검수 전용 계정 만들기 / 역할 바꾸기.
 *
 *   npx tsx scripts/qa/create-reviewer.ts <이메일> <비밀번호> [--name 이름]
 *   npx tsx scripts/qa/create-reviewer.ts <이메일> --role director   (되돌리기)
 *   npx tsx scripts/qa/create-reviewer.ts --list
 *   npx tsx scripts/qa/create-reviewer.ts <이메일> --delete
 *
 * ⚠️ 이미 있는 이메일이면 **비밀번호를 덮어쓰지 않고** 역할만 바꾼다.
 *    비밀번호를 조용히 갈아 끼우면 원장님이 쓰던 계정으로 로그인이 안 된다.
 *
 * ⚠️ 역할은 **JWT 에 실려** 다닌다(src/lib/routeAccess.ts). 이미 로그인해 둔
 *    브라우저는 **다시 로그인해야** 바뀐 역할이 먹는다.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--list")) {
    const users = await prisma.user.findMany({
      select: { email: true, name: true, role: true, deletedAt: true },
      orderBy: { createdAt: "asc" },
    });
    for (const u of users) {
      console.log(
        `${u.role.padEnd(9)} ${u.email}${u.name ? ` (${u.name})` : ""}${u.deletedAt ? " [탈퇴]" : ""}`,
      );
    }
    return;
  }

  const email = argv[0];
  if (!email || email.startsWith("--")) {
    console.error("이메일이 없다. 사용법은 이 파일 머리말을 보라.");
    process.exit(1);
  }

  if (argv.includes("--delete")) {
    const gone = await prisma.user.deleteMany({ where: { email } });
    console.log(`${email} — ${gone.count}건 지웠다.`);
    return;
  }

  const role = (arg("--role") ?? "reviewer") as "director" | "reviewer";
  if (role !== "director" && role !== "reviewer") {
    console.error(`모르는 역할: ${role}`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role } });
    console.log(
      `${email} 는 이미 있다 — 역할만 ${role} 로 바꿨다(비밀번호는 그대로).`,
    );
    console.log("⚠️ 그 계정으로 로그인 중이면 **다시 로그인**해야 바뀐다.");
    return;
  }

  const password = argv[1];
  if (!password || password.startsWith("--")) {
    console.error("새 계정이면 비밀번호가 있어야 한다.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("비밀번호는 8자 이상이어야 한다.");
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: arg("--name") ?? "검수",
      passwordHash: await hash(password, 10),
      role,
    },
    select: { id: true, email: true, role: true },
  });
  console.log(`만들었다 — ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
