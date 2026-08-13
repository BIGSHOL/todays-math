import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/**
 * Node(Vitest) 환경용 MSW 서버.
 * 라이프사이클(listen/resetHandlers/close)은 vitest.setup.ts에서 연결한다.
 */
export const server = setupServer(...handlers);
