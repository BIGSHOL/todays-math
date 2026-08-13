import { execSync } from "node:child_process";
import path from "node:path";

import { E2E_ENV } from "./env";
import { seedE2eFixtures } from "./helpers/seed";

function sh(command: string) {
  execSync(command, {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ...E2E_ENV },
    stdio: "inherit",
    shell: true,
  });
}

function waitForPostgres() {
  for (let i = 0; i < 30; i += 1) {
    try {
      execSync("docker exec postgres_db pg_isready -U postgres", {
        stdio: "pipe",
        shell: true,
      });
      return;
    } catch {
      execSync('powershell -Command "Start-Sleep -Seconds 2"', {
        stdio: "pipe",
        shell: true,
      });
    }
  }
  throw new Error("E2E Postgres(postgres_db:5433)가 준비되지 않았습니다.");
}

function ensureDatabase() {
  const exists = execSync(
    "docker exec postgres_db psql -U postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='todaysmath_e2e'\"",
    { encoding: "utf8", shell: true },
  ).trim();
  if (exists !== "1") {
    sh(
      'docker exec postgres_db psql -U postgres -c "CREATE DATABASE todaysmath_e2e;"',
    );
  }
}

export default async function globalSetup() {
  Object.assign(process.env, E2E_ENV);
  sh("docker compose up -d");
  waitForPostgres();
  ensureDatabase();
  sh("npx prisma migrate deploy");
  sh("npx prisma db seed");
  await seedE2eFixtures();
}
