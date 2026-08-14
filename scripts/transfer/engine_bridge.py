"""Version-pinned JSON adapter for the external 시험지변환기 engines.

This file contains no copied engine implementation. It verifies the configured source
files, imports only the pinned modules, and emits one bounded JSON response. Figure SVG
can leave this process only after ``figure_quality.sanitize_svg`` succeeds.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import io
import json
import math
import os
from pathlib import Path
import sys
from typing import Any


MAX_REQUEST_BYTES = 30 * 1024 * 1024
CONTRACT_VERSION = 1


class BridgeError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BridgeError("manifest_invalid", f"엔진 manifest를 읽지 못했습니다: {exc}") from exc
    if not isinstance(value, dict):
        raise BridgeError("manifest_invalid", "엔진 manifest 최상위는 객체여야 합니다.")
    return value


def _verify_source(source_root: Path, manifest: dict[str, Any]) -> None:
    required = manifest.get("requiredFiles")
    if not isinstance(required, dict) or not required:
        raise BridgeError("manifest_invalid", "requiredFiles가 비어 있습니다.")
    for relative, expected in required.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise BridgeError("manifest_invalid", "requiredFiles 형식이 잘못됐습니다.")
        candidate = (source_root / relative).resolve()
        try:
            candidate.relative_to(source_root)
        except ValueError as exc:
            raise BridgeError("manifest_invalid", f"source root 밖 파일은 허용하지 않습니다: {relative}") from exc
        if not candidate.is_file():
            raise BridgeError("engine_file_missing", f"필수 엔진 파일이 없습니다: {relative}")
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if digest != expected.lower():
            raise BridgeError(
                "engine_version_mismatch",
                f"엔진 파일 해시가 고정 버전과 다릅니다: {relative}",
            )


def _import_figures(source_root: Path):
    root_text = str(source_root)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    figure_svg = importlib.import_module("core.figure_svg")
    figure_solid = importlib.import_module("core.figure_solid")
    figure_quality = importlib.import_module("core.figure_quality")
    return figure_svg, figure_solid, figure_quality


def _dash(value: Any) -> str | None:
    if value is None:
        return None
    return " ".join(str(float(item)) for item in value)


def _projection(solid, spec: dict[str, Any]):
    if spec["kind"] == "view":
        return solid.View(
            depth_ratio=float(spec["depthRatio"]),
            depth_deg=float(spec["depthDeg"]),
            scale=float(spec["scale"]),
            origin=tuple(spec["origin"]),
        )
    return solid.Camera(
        elev=float(spec["elev"]),
        azim=float(spec["azim"]),
        scale=float(spec["scale"]),
        origin=tuple(spec["origin"]),
    )


def _wrap_and_sanitize(quality, width: int, height: int, body: list[str]) -> str:
    raw = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">'
        + "\n".join(body)
        + "</svg>"
    )
    return quality.sanitize_svg(raw)


def _render_figure(source_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    fs, solid, quality = _import_figures(source_root)
    width, height = int(request["width"]), int(request["height"])
    body: list[str] = []
    for element in request["elements"]:
        kind = element["kind"]
        if kind == "line":
            body.append(fs.line(tuple(element["start"]), tuple(element["end"]),
                                float(element["width"]), _dash(element.get("dash"))))
        elif kind == "circle":
            body.append(fs.circ(*element["center"], float(element["radius"]),
                                float(element["width"])))
        elif kind == "dot":
            body.append(fs.dot(*element["point"], float(element["radius"])))
        elif kind == "label":
            body.append(fs.txt(*element["point"], element["text"],
                               float(element["fontSize"]), element["anchor"],
                               bool(element["italic"])))
        elif kind == "polyline":
            body.append(fs.curve_path(element["points"], float(element["width"]),
                                      _dash(element.get("dash")),
                                      bool(element["close"])))
        elif kind == "solidPolyline":
            view = _projection(solid, element["projection"])
            points = view.many(element["points"])
            body.append(fs.curve_path(points, float(element["width"]),
                                      _dash(element.get("dash")),
                                      bool(element["close"])))
        else:
            raise BridgeError("unsupported_figure_element", f"지원하지 않는 도형 요소: {kind}")
    svg = _wrap_and_sanitize(quality, width, height, body)
    return {"svg": svg, "sanitized": True, "generatorModules": ["figure_svg", "figure_solid"]}


def _qa_fixtures(source_root: Path) -> dict[str, Any]:
    fs, solid, quality = _import_figures(source_root)
    fixtures: list[dict[str, Any]] = []

    # 좌표축, 점, 선분, 화살표, 곡선과 한글/수학 라벨.
    body: list[str] = []
    for x in range(50, 341, 50):
        body.append(fs.line((x, 25), (x, 215), 0.55, "3 4"))
    for y in range(40, 211, 40):
        body.append(fs.line((25, y), (345, y), 0.55, "3 4"))
    body.extend([
        fs.leader((25, 190), (345, 190), arrow=True, w=1.2, gap=0),
        fs.leader((55, 220), (55, 20), arrow=True, w=1.2, gap=0),
    ])
    curve = [(x, 190 - 0.006 * (x - 180) ** 2) for x in range(65, 321, 6)]
    body.extend([
        fs.curve_path(curve, 2),
        fs.line((85, 170), (285, 70), 2),
        fs.dot(180, 190, 3),
        fs.dot(255, 104, 3),
        fs.txt(337, 207, "x", 15, "end", True),
        fs.txt(43, 28, "y", 15, "end", True),
        fs.txt(180, 232, "좌표평면 · y=x² · 점 P", 14),
    ])
    fixtures.append({
        "id": "coordinate-curve",
        "title": "좌표평면 / 축 / 점 / 선분 / 화살표 / 곡선",
        "svg": _wrap_and_sanitize(quality, 370, 245, body),
        "sanitized": True,
    })

    # 원, 접선, 각도호, 각 라벨과 자동 점 라벨.
    center, radius, angle = (175.0, 118.0), 68.0, 32.0
    tangent = fs.tangent_seg(*center, radius, angle, 85, 85)
    touch = fs.circle_pt(*center, angle, radius)
    vertex, ray_a, ray_b = (58.0, 198.0), (142.0, 198.0), (111.0, 126.0)
    avoid = [(vertex, ray_a), (vertex, ray_b), tangent]
    body = [
        fs.circ(*center, radius, 2),
        fs.line(*tangent, 2),
        fs.line(vertex, ray_a, 2),
        fs.line(vertex, ray_b, 2),
        fs.angle_mark(*vertex, ray_a, ray_b, r=26, dash=False),
        fs.angle_label(*vertex, ray_a, ray_b, content="35°", fs=13,
                       arc_r=26, avoid=avoid, circles=[(*center, radius)]),
        fs.leader((280, 205), touch, arrow=True, w=1.0, gap=5),
        fs.dot(*touch, 3),
        fs.point_labels([(*touch, "T"), (*center, "O")], avoid=avoid,
                        circles=[(*center, radius)], fs=14),
        fs.txt(190, 235, "접선 ℓ · ∠A=35° · 원 O", 14),
    ]
    fixtures.append({
        "id": "circle-tangent-angle",
        "title": "원 / 접선 / 각도호 / 각 라벨 / 지시 화살표",
        "svg": _wrap_and_sanitize(quality, 370, 250, body),
        "sanitized": True,
    })

    # figure_solid 사투영: 직육면체와 숨은선.
    view = solid.View(depth_ratio=0.5, depth_deg=38, scale=62, origin=(105, 205))
    points = {
        "A": (0, 0, 0), "B": (2.5, 0, 0), "C": (2.5, 1.5, 0), "D": (0, 1.5, 0),
        "E": (0, 0, 2), "F": (2.5, 0, 2), "G": (2.5, 1.5, 2), "H": (0, 1.5, 2),
    }
    projected = {name: view(point) for name, point in points.items()}
    hidden = [("C", "D"), ("D", "A"), ("D", "H")]
    visible = [
        ("A", "B"), ("B", "C"), ("A", "E"), ("B", "F"), ("C", "G"),
        ("E", "F"), ("F", "G"), ("G", "H"), ("H", "E"),
    ]
    body = [fs.line(projected[a], projected[b], 1.3, "5 4") for a, b in hidden]
    body.extend(fs.line(projected[a], projected[b], 2) for a, b in visible)
    body.append(fs.point_labels(
        [(x, y, name) for name, (x, y) in projected.items()],
        avoid=[(projected[a], projected[b]) for a, b in hidden + visible], fs=13,
    ))
    body.append(fs.txt(205, 245, "공간도형 ABCD-EFGH · 사투영", 14))
    fixtures.append({
        "id": "solid-view",
        "title": "figure_solid 직육면체 / 사투영 / 숨은선",
        "svg": _wrap_and_sanitize(quality, 410, 260, body),
        "sanitized": True,
    })

    # figure_solid 정투영: 구, 공간 원과 평면 윤곽.
    camera = solid.Camera(elev=24, azim=-56, scale=58, origin=(205, 135))
    ring3 = solid.circle3((0, 0, 0), 1.35, (0, 0, 1), n=96)
    plane3 = [(-2, -1.4, -0.25), (2, -1.4, -0.25), (2, 1.4, -0.25), (-2, 1.4, -0.25)]
    body = [
        fs.curve_path(camera.many(plane3), 1.2, close=True),
        fs.shaded_sphere(205, 135, 78, "qaSphere"),
        fs.curve_path(camera.many(ring3), 1.5, "5 4", close=True),
        fs.txt(205, 250, "구 S · 평면 α · 정투영 원", 14),
    ]
    fixtures.append({
        "id": "solid-camera",
        "title": "figure_solid 구 / 평면 / 정투영 곡선",
        "svg": _wrap_and_sanitize(quality, 410, 265, body),
        "sanitized": True,
    })

    return {"fixtures": fixtures, "sanitizedCount": len(fixtures)}


def _security_probe(source_root: Path) -> dict[str, Any]:
    _, _, quality = _import_figures(source_root)
    probes = {
        "script": '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
        "event": '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" onload="alert(1)"/></svg>',
        "externalHref": '<svg viewBox="0 0 10 10"><image href="https://example.com/x.png"/></svg>',
        "foreignObject": '<svg viewBox="0 0 10 10"><foreignObject><p>x</p></foreignObject></svg>',
        "filter": '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" filter="url(#x)"/></svg>',
    }
    rejected: list[str] = []
    accepted: list[str] = []
    for name, svg in probes.items():
        try:
            quality.sanitize_svg(svg)
            accepted.append(name)
        except Exception:
            rejected.append(name)
    if accepted:
        raise BridgeError("sanitizer_probe_failed", f"금지 SVG가 허용됐습니다: {', '.join(accepted)}")
    return {"probeCount": len(probes), "rejected": rejected, "accepted": accepted}


def _import_ocr(source_root: Path):
    root_text = str(source_root)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    return importlib.import_module("core.ocr_engine")


def _ocr_validate(source_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    ocr = _import_ocr(source_root)
    quality = ocr.validate_ocr_response(request["result"])
    return {
        "valid": bool(quality.valid),
        "warnings": list(quality.warnings),
        "questionCount": int(quality.question_count),
        "equationCount": int(quality.equation_count),
    }


def _ocr_recognize(source_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    try:
        raw = base64.b64decode(request["imageBase64"], validate=True)
    except Exception as exc:
        raise BridgeError("image_invalid", "imageBase64가 올바르지 않습니다.") from exc
    if len(raw) > 20 * 1024 * 1024:
        raise BridgeError("image_too_large", "OCR 입력 이미지는 20MiB 이하여야 합니다.")

    ocr = _import_ocr(source_root)
    from PIL import Image

    backend = request["backend"]
    key_name = "ANTHROPIC_API_KEY" if backend == "claude" else "GEMINI_API_KEY"
    api_key = (os.environ.get(key_name) or os.environ.get("TESTCHANGER_OCR_API_KEY") or "").strip()
    if not api_key:
        raise BridgeError("ocr_key_missing", f"{key_name} 서버 환경값이 필요합니다.")

    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            engine = ocr.OCREngine(api_key=api_key, backend=backend, model=request.get("model"))
            result = engine.recognize_page(image) if request["mode"] == "page" else engine.recognize_crop(image)
    except BridgeError:
        raise
    except Exception as exc:
        raise BridgeError("ocr_failed", f"OCR 실행에 실패했습니다: {type(exc).__name__}: {exc}") from exc
    return {"ocr": result, "usage": engine.usage, "backend": backend}


def _handle(source_root: Path, manifest: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    if request.get("contractVersion") != CONTRACT_VERSION:
        raise BridgeError("contract_version_mismatch", "지원하지 않는 계약 버전입니다.")
    operation = request.get("operation")
    if operation == "health":
        return {
            "sourceCommit": manifest.get("sourceCommit"),
            "releaseVersion": manifest.get("releaseVersion"),
            "sourceLicense": manifest.get("sourceLicense"),
            "capabilities": [
                "figure.render", "figure.qaFixtures", "figure.securityProbe",
                "ocr.validate", "ocr.recognize",
            ],
            "hashesVerified": True,
        }
    if operation == "figure.render":
        return _render_figure(source_root, request)
    if operation == "figure.qaFixtures":
        return _qa_fixtures(source_root)
    if operation == "figure.securityProbe":
        return _security_probe(source_root)
    if operation == "ocr.validate":
        return _ocr_validate(source_root, request)
    if operation == "ocr.recognize":
        return _ocr_recognize(source_root, request)
    raise BridgeError("operation_unknown", f"지원하지 않는 operation입니다: {operation!r}")


def _redact(message: str) -> str:
    redacted = message
    for key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "TESTCHANGER_OCR_API_KEY"):
        value = os.environ.get(key)
        if value:
            redacted = redacted.replace(value, "<redacted>")
    return redacted[:2000]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--source-root", required=True)
    args = parser.parse_args()
    operation: str | None = None
    try:
        manifest_path = Path(args.manifest).resolve()
        source_root = Path(args.source_root).resolve()
        manifest = _read_json(manifest_path)
        _verify_source(source_root, manifest)
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise BridgeError("request_too_large", "요청이 30MiB 제한을 넘었습니다.")
        request = json.loads(raw.decode("utf-8"))
        if not isinstance(request, dict):
            raise BridgeError("request_invalid", "요청 최상위는 객체여야 합니다.")
        operation = request.get("operation") if isinstance(request.get("operation"), str) else None
        result = _handle(source_root, manifest, request)
        response = {
            "contractVersion": CONTRACT_VERSION,
            "ok": True,
            "operation": operation,
            "result": result,
        }
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 0
    except BridgeError as exc:
        response = {
            "contractVersion": CONTRACT_VERSION,
            "ok": False,
            "operation": operation,
            "error": {"code": exc.code, "message": _redact(str(exc))},
        }
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 1
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        response = {
            "contractVersion": CONTRACT_VERSION,
            "ok": False,
            "operation": operation,
            "error": {"code": "request_invalid", "message": _redact(str(exc))},
        }
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 1
    except Exception as exc:
        response = {
            "contractVersion": CONTRACT_VERSION,
            "ok": False,
            "operation": operation,
            "error": {"code": "bridge_failed", "message": _redact(f"{type(exc).__name__}: {exc}")},
        }
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
