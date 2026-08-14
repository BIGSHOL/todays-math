import { Prisma } from "@prisma/client";

/** Narrow an unknown Prisma failure without matching unstable error-message text. */
export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
