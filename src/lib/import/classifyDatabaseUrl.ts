export type DatabaseTargetKind =
  "local_dev" | "supabase" | "neon" | "remote_unknown" | "missing";

export interface DatabaseTarget {
  kind: DatabaseTargetKind;
  /** 호스트명만. 비밀번호·쿼리는 절대 넣지 않는다. */
  host: string | null;
  isLocalDev: boolean;
  canMigrateOrLoad: boolean;
  reason: string;
}

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "postgres_db",
]);

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

/** DATABASE_URL이 로컬 docker/개발 DB인지 판별한다. 비밀값은 결과에 넣지 않는다. */
export function classifyDatabaseUrl(
  url: string | undefined | null,
): DatabaseTarget {
  if (url === undefined || url === null || stripQuotes(url) === "") {
    return {
      kind: "missing",
      host: null,
      isLocalDev: false,
      canMigrateOrLoad: false,
      reason: "DATABASE_URL이 없습니다.",
    };
  }

  const raw = stripQuotes(url);
  let hostname: string;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return {
      kind: "remote_unknown",
      host: null,
      isLocalDev: false,
      canMigrateOrLoad: false,
      reason: "DATABASE_URL 파싱에 실패했습니다.",
    };
  }

  if (LOCAL_HOSTS.has(hostname) || hostname.endsWith(".local")) {
    return {
      kind: "local_dev",
      host: hostname,
      isLocalDev: true,
      canMigrateOrLoad: true,
      reason: "로컬/개발 Docker PostgreSQL",
    };
  }

  if (hostname.includes("supabase") || hostname.includes("pooler.supabase")) {
    return {
      kind: "supabase",
      host: hostname,
      isLocalDev: false,
      canMigrateOrLoad: false,
      reason: "공유 Supabase — 프로덕션이라 적재 안 함",
    };
  }

  if (hostname.includes("neon.tech")) {
    return {
      kind: "neon",
      host: hostname,
      isLocalDev: false,
      canMigrateOrLoad: false,
      reason: "원격 Neon — 프로덕션이라 적재 안 함",
    };
  }

  return {
    kind: "remote_unknown",
    host: hostname,
    isLocalDev: false,
    canMigrateOrLoad: false,
    reason: `원격 호스트(${hostname}) — 적재 안 함`,
  };
}
