# -*- coding: utf-8 -*-
"""`.hwp` → `.hwpx` 변환 — **창을 안 띄운다.**

## 왜 우리 계층에 있나

벤더링본 `scripts/vendor/testchanger/hwp_extract.py:to_hwpx` 는 COM 객체를 만든 뒤
**`Visible` 을 건드리지 않는다.** 그래서 편마다 한글 창이 떠서 포커스를 가져간다 —
2026-08-19 에 원장님이 **타이핑이 끊긴다**고 하셔서 드러났다(236편 × 12.8초 × 4프로세스).

같은 저장소의 `core/hwp_com.py` 는 이미 `CONVERSION_VISIBLE = False` 를 기본값으로
두고 그 이유까지 적어 두었다 — 창이 보이면 **사용자가 다른 한글 문서로 포커스를 옮길 때
COM 작성이 그 문서에 타이핑돼 원본을 훼손**한다(2026-06-08 실제 데이터 손상). 즉
숨김은 편의가 아니라 **안전** 문제다. 그런데 `to_hwpx` 만 그 설정을 안 쓴다.

벤더링본은 읽기 전용이다(tracks/README §3) — 고치면 다음 재벤더링 때 조용히 사라진다.
그래서 **여기서 같은 일을 하되 숨김·대화상자 자동응답을 켠 판**을 둔다.
**상류에도 알려야 할 결함이다.**

## 무엇을 더 켜나

| | 왜 |
| --- | --- |
| `XHwpWindows.Item(0).Visible = False` | 포커스를 안 뺏는다. Open **전후 두 번** 건다 — 문서를 열면 창이 새로 생긴다 |
| `SetMessageBoxMode(0xFFFFFF)` | 복구·저장 대화상자를 자동응답. 안 걸면 배치가 팝업에서 **멈춘다** |
| `RegisterModule(FilePathCheckDLL)` | 「파일 접근 허용」 보안 팝업 억제 (벤더링본과 같다) |

## 🔴 창을 숨기는 것만으로는 **안 막힌다** — 실측

`Visible = False` 를 Dispatch 직후에 걸어도 포커스는 그대로 넘어간다.
훔치는 시점이 **`Dispatch` 그 순간**이라 내가 숨기기 **전**이다. 실측(같은 파일 3회):

| | 산출물 | 포커스가 넘어간 횟수 |
| --- | --- | ---: |
| 벤더링본 | 3개 | 5 |
| 숨김만 (`Visible=False`) | 3개 | 5 |
| **숨김 + 별도 데스크톱** | 3개 | **0** |

그래서 **스레드를 별도 데스크톱에 붙인다**(`SetThreadDesktop`). 그 데스크톱의 창은
사용자 화면에 나타날 수 없으므로 전경을 가져갈 방법이 없다. 속도는 같다(5.4 vs 5.6초).

⚠️ **「0」을 믿기 전에 «일을 실제로 했는지» 부터 봐라.** 처음 `SetThreadDesktop` 이
없는 API 라 예외가 났을 때도 **포커스 0회**가 나왔다 — 변환이 아예 안 돌았으니까.
검증기(`_desktest.py`)는 그래서 산출물 크기를 먼저 단언한다.
"""
import pathlib
import re
import shutil
import sys


_ISOLATED = False


def isolate_desktop(name: str = "hwpbatch") -> bool:
    """이 스레드를 **별도 데스크톱**에 붙인다 — 여기 뜨는 창은 전경을 못 가져간다.

    COM 을 처음 부르기 **전에** 한 번 부른다. 창을 이미 만든 스레드에서는 실패한다.
    실패하면 `False` 를 돌려준다 — 부르는 쪽이 **조용히 넘어가지 말고** 판단할 것.
    """
    global _ISOLATED
    if _ISOLATED:
        return True
    import ctypes

    u = ctypes.windll.user32
    u.CreateDesktopW.restype = ctypes.c_void_p
    handle = u.CreateDesktopW(name, None, None, 0, 0x10000000, None)  # GENERIC_ALL
    if not handle:
        return False
    u.SetThreadDesktop.argtypes = [ctypes.c_void_p]
    if not u.SetThreadDesktop(ctypes.c_void_p(handle)):
        return False
    _ISOLATED = True
    return True


def to_hwpx_quiet(src: pathlib.Path, workdir: pathlib.Path) -> pathlib.Path:
    """`.hwp` 를 `.hwpx` 로. `.hwpx` 는 그대로 돌려준다."""
    if src.suffix.lower() == ".hwpx":
        return src

    vendor = pathlib.Path(__file__).resolve().parent.parent / "vendor" / "testchanger"
    sys.path.insert(0, str(vendor))
    from core import hwp_com  # noqa: E402

    hwp_com.ensure_com_initialized()
    import win32com.client  # noqa: E402

    local = workdir / re.sub(r"[^\w.\-]", "_", src.name)
    shutil.copy2(src, local)
    out = local.with_suffix(".hwpx")

    app = win32com.client.Dispatch("HWPFrame.HwpObject")
    try:
        # 대화상자 자동응답 — 안 걸면 배치가 팝업에서 멈춘다.
        try:
            app.SetMessageBoxMode(0xFFFFFF)
        except Exception:
            pass
        try:
            hwp_com._register_security_module()
        except Exception:
            pass
        try:
            app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass
        _hide(app)

        if not app.Open(str(local.resolve()), "HWP", "forceopen:true"):
            raise RuntimeError("HWP Open 실패")
        # ⚠️ 문서를 열면 창이 **새로 생긴다.** 한 번만 걸면 그때부터 다시 보인다.
        _hide(app)

        app.SaveAs(str(out.resolve()), "HWPX", "")
    finally:
        try:
            app.Quit()
        except Exception:
            pass

    if not out.exists():
        raise RuntimeError("HWPX 변환 실패")
    return out


def _hide(app) -> None:
    """열려 있는 창을 **전부** 숨긴다 — `Item(0)` 만 걸면 둘째 문서가 뜬다."""
    try:
        wins = app.XHwpWindows
        for i in range(int(wins.Count)):
            try:
                wins.Item(i).Visible = False
            except Exception:
                pass
    except Exception:
        try:
            app.XHwpWindows.Item(0).Visible = False
        except Exception:
            pass
