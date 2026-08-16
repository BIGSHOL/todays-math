/**
 * 트랙 G 가 읽는 산출물 위치.
 *
 * 본문·메타는 **트랙 D 가 이미 추출해 둔 것**을 쓴다. 재추출은 약 10.5시간이
 * 헛돌고 결과도 같다(브리프 §5.4). 원본 저장소·N드라이브는 읽지 않는다.
 */
export const TRACK_D_REPORTS =
  process.env.TRACK_D_REPORTS ??
  "C:/Users/user/orca/workspaces/testautocreator/잔여-D-HWP/scripts/qa/reports";

export const OUT_DIR = "scripts/classify/reports";
export const UNITS_FILE = `${OUT_DIR}/units-db.json`;
export const LABELED_FILE = `${OUT_DIR}/labeled.jsonl`;
export const TARGET_FILE = `${OUT_DIR}/target.jsonl`;
export const DATASET_SUMMARY = `${OUT_DIR}/dataset-summary.json`;

export type Unit = {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
};

export type ExamMeta = {
  examId: number;
  school: string;
  level: string;
  grade: number | null;
  subject: string | null;
  year: number | null;
  semester: number | null;
  round: string | null;
};

/**
 * 고등 과목명 → 교육과정 라벨. `scripts/qa/final_meta.py` 의 HIGH_SUBJECT 와 같은 표다.
 * ⚠️ 수Ⅰ→대수 · 수Ⅱ→미적분1 · 미적분→미적분2 는 원장님 확인 대상(08 §5.1.5).
 */
const HIGH_SUBJECT: Record<string, string> = {
  수상: "공통수학1", 공수1: "공통수학1", 고등수학상: "공통수학1", 상1: "공통수학1",
  수하: "공통수학2", 공수2: "공통수학2", 수1: "대수", "심화 수1": "대수",
  수2: "미적분1", 문과수2: "미적분1", 미적분: "미적분2", 미적분1: "미적분2",
  확통: "확률과 통계", 기하: "기하", 기벡: "기하",
};

/**
 * 시험지 메타 → `Unit.grade`.
 * 실측(2026-08-16): 이미 분류된 23,268문항 **전부**에서 이 값이 라벨의 학년과 일치했다.
 * 학년은 추정이 아니라 사실상 확정 정보다.
 */
export function gradeKeyOf(meta: ExamMeta): string | null {
  const subject = (meta.subject ?? "").trim();
  if (meta.level === "중") {
    const inSubject = subject.match(/^중([123])/);
    if (inSubject) return `중${inSubject[1]}`;
    return [1, 2, 3].includes(meta.grade as number) ? `중${meta.grade}` : null;
  }
  return HIGH_SUBJECT[subject] ?? null;
}
