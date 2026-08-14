# 오늘의수학

동네 수학학원을 위한 진도 기반 시험지 자동 출제 도구.

## 기술 스택

- Next.js 16 (App Router) + TypeScript + React 19
- Tailwind CSS v4
- Prisma + PostgreSQL, Zod
- Auth.js (이메일/구글), Claude API, KaTeX

## 시작하기

```bash
npm install
cp .env.example .env   # 값 채우기
npm run dev            # http://localhost:3000
```

## 스크립트

| 명령                 | 설명          |
| -------------------- | ------------- |
| `npm run dev`        | 개발 서버     |
| `npm run build`      | 프로덕션 빌드 |
| `npm run lint`       | ESLint        |
| `npm run type-check` | tsc --noEmit  |

기획 문서는 `docs/planning/` 참조.  
다른 컴퓨터에서 이어서 할 때: **`docs/HANDOFF.md`**.
