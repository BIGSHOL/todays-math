"""math_test 시드를 JSON으로만 덤프한다. 원본 저장소는 수정하지 않는다."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(r"F:\math_test\backend")


def main() -> None:
    sys.path.insert(0, str(BACKEND))
    from app.seeds import get_all_grade_seed_data  # type: ignore

    data = get_all_grade_seed_data()
    concepts = {c["id"]: c for c in data.get("concepts", [])}
    questions = []
    for q in data.get("questions", []):
        concept = concepts.get(q.get("concept_id", ""), {})
        questions.append(
            {
                **q,
                "concept_name": concept.get("name", ""),
                "concept_grade": concept.get("grade", ""),
            }
        )
    json.dump(
        {"concepts": list(concepts.values()), "questions": questions},
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
