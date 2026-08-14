import { spawn } from "node:child_process";
import path from "node:path";

import {
  TestchangerEngineRequestSchema,
  TestchangerEngineResponseSchema,
  type TestchangerEngineRequest,
} from "./contracts";

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export interface TestchangerCliOptions {
  sourceRoot?: string;
  pythonExecutable?: string;
  bridgePath?: string;
  manifestPath?: string;
  timeoutMs?: number;
}

export class TestchangerEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TestchangerEngineError";
  }
}

function childEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "TESTCHANGER_OCR_API_KEY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
  ] as const;
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH ?? process.env.Path,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
  for (const key of allowedKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function redactKnownSecrets(message: string): string {
  let redacted = message;
  for (const key of [
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "TESTCHANGER_OCR_API_KEY",
  ] as const) {
    const value = process.env[key];
    if (value) redacted = redacted.replaceAll(value, "<redacted>");
  }
  return redacted.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "<redacted-db-url>");
}

export async function runTestchangerEngine(
  request: TestchangerEngineRequest,
  options: TestchangerCliOptions = {},
) {
  const parsedRequest = TestchangerEngineRequestSchema.parse(request);
  const sourceRoot = options.sourceRoot ?? process.env.TESTCHANGER_ROOT;
  if (!sourceRoot) {
    throw new TestchangerEngineError(
      "source_root_missing",
      "TESTCHANGER_ROOT 또는 sourceRoot 옵션이 필요합니다.",
    );
  }

  const pythonExecutable =
    options.pythonExecutable ?? process.env.TESTCHANGER_PYTHON ?? "python";
  const bridgePath = path.resolve(
    /* turbopackIgnore: true */
    options.bridgePath ??
      path.join(process.cwd(), "scripts/transfer/engine_bridge.py"),
  );
  const manifestPath = path.resolve(
    /* turbopackIgnore: true */
    options.manifestPath ??
      path.join(process.cwd(), "config/testchanger-engine.json"),
  );
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return new Promise<
    Extract<
      ReturnType<typeof TestchangerEngineResponseSchema.parse>,
      { ok: true }
    >
  >((resolve, reject) => {
    const child = spawn(
      /* turbopackIgnore: true */
      pythonExecutable,
      [
        bridgePath,
        "--manifest",
        manifestPath,
        "--source-root",
        path.resolve(sourceRoot),
      ],
      {
        cwd: process.cwd(),
        env: childEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill();
      fail(
        new TestchangerEngineError(
          "timeout",
          `시험지변환기 어댑터가 ${timeoutMs}ms 안에 끝나지 않았습니다.`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill();
        fail(
          new TestchangerEngineError(
            "stdout_too_large",
            "시험지변환기 응답이 32MiB 제한을 넘었습니다.",
          ),
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(chunk);
    });
    child.on("error", (error) => {
      fail(
        new TestchangerEngineError(
          "spawn_failed",
          redactKnownSecrets(error.message),
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);

      const raw = Buffer.concat(stdout).toString("utf8").trim();
      let response: unknown;
      try {
        response = JSON.parse(raw);
      } catch {
        const detail = redactKnownSecrets(
          Buffer.concat(stderr).toString("utf8").trim(),
        );
        fail(
          new TestchangerEngineError(
            "invalid_response",
            `시험지변환기 응답이 JSON이 아닙니다 (exit=${code ?? "null"})${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }

      const parsed = TestchangerEngineResponseSchema.safeParse(response);
      if (!parsed.success) {
        fail(
          new TestchangerEngineError(
            "contract_violation",
            "시험지변환기 응답이 고정 계약을 위반했습니다.",
          ),
        );
        return;
      }
      if (!parsed.data.ok) {
        fail(
          new TestchangerEngineError(
            parsed.data.error.code,
            redactKnownSecrets(parsed.data.error.message),
          ),
        );
        return;
      }
      if (code !== 0) {
        fail(
          new TestchangerEngineError(
            "nonzero_exit",
            `시험지변환기 어댑터가 exit=${code ?? "null"}로 종료됐습니다.`,
          ),
        );
        return;
      }

      settled = true;
      resolve(parsed.data);
    });

    child.stdin.end(JSON.stringify(parsedRequest));
  });
}
