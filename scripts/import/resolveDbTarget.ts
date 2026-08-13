import path from "node:path";

import {
  classifyDatabaseUrl,
  type DatabaseTarget,
} from "../../src/lib/import/classifyDatabaseUrl";
import { readEnvFile } from "./readEnvFile";

export interface DatabaseInspection {
  env: DatabaseTarget;
  worktreeDotenv: DatabaseTarget;
  mainRepoDotenv: DatabaseTarget;
  selected: DatabaseTarget;
  selectedSource: "env" | "worktree-dotenv" | "none";
}

const MAIN_REPO_ENV = "C:\\Creative\\testautocreator\\.env";

export async function inspectDatabaseTargets(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<DatabaseInspection> {
  const envTarget = classifyDatabaseUrl(env.DATABASE_URL);
  const worktreeFile = await readEnvFile(path.join(cwd, ".env"));
  const worktreeDotenv = classifyDatabaseUrl(worktreeFile?.DATABASE_URL);
  const mainFile = await readEnvFile(MAIN_REPO_ENV);
  const mainRepoDotenv = classifyDatabaseUrl(mainFile?.DATABASE_URL);

  if (env.DATABASE_URL) {
    return {
      env: envTarget,
      worktreeDotenv,
      mainRepoDotenv,
      selected: envTarget,
      selectedSource: "env",
    };
  }
  if (worktreeFile?.DATABASE_URL) {
    return {
      env: envTarget,
      worktreeDotenv,
      mainRepoDotenv,
      selected: worktreeDotenv,
      selectedSource: "worktree-dotenv",
    };
  }
  return {
    env: envTarget,
    worktreeDotenv,
    mainRepoDotenv,
    selected: classifyDatabaseUrl(undefined),
    selectedSource: "none",
  };
}
