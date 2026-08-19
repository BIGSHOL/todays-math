# -*- coding: utf-8 -*-
"""별도 데스크톱으로 격리하면 포커스를 못 뺏는가 — **실측.**
사용:
  python scripts/qa/verify-hwp-focus.py "<원본.hwp>" 3            # 같은 데스크톱 (대조군)
  python scripts/qa/verify-hwp-focus.py "<원본.hwp>" 3 --desktop  # 별도 데스크톱

실측 (2026-08-19, 같은 파일 3회):

| | 산출물 | 포커스가 넘어간 횟수 |
| --- | --- | ---: |
| 같은 데스크톱 | 3개 | **5** |
| 별도 데스크톱 | 3개 | **0** |

속도는 같다(5.4 vs 5.6초).
"""
import pathlib, sys, tempfile, time, threading
sys.path.insert(0, str(pathlib.Path("scripts/qa").resolve()))
import win32gui, win32process, win32api, win32con, win32service

steals = []
stop = threading.Event()

def poll():
    prev = win32gui.GetForegroundWindow()
    while not stop.is_set():
        try:
            fg = win32gui.GetForegroundWindow()
            if fg and fg != prev:
                _, pid = win32process.GetWindowThreadProcessId(fg)
                try:
                    h = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                    name = win32process.GetModuleFileNameEx(h, 0).rsplit("\\", 1)[-1]
                    win32api.CloseHandle(h)
                except Exception:
                    name = f"pid{pid}"
                steals.append((name, win32gui.GetWindowText(fg)[:45]))
                prev = fg
        except Exception:
            pass
        time.sleep(0.05)

t = threading.Thread(target=poll, daemon=True); t.start()

SIZES = []

def work(src, n):
    # ⚠️ 「포커스 0회」가 참이려면 **변환이 실제로 됐어야** 한다.
    #    앞서 SetThreadDesktop 이 죽었을 때도 0회가 나왔다 — 일을 안 했으니까.
    from hwp_to_hwpx_quiet import to_hwpx_quiet
    with tempfile.TemporaryDirectory() as wd:
        for i in range(n):
            out = to_hwpx_quiet(pathlib.Path(src), pathlib.Path(wd))
            SIZES.append(out.stat().st_size)

src, n = sys.argv[1], int(sys.argv[2])
started = time.time()

if "--desktop" in sys.argv:
    done = {}
    def runner():
        import ctypes
        u = ctypes.windll.user32
        u.CreateDesktopW.restype = ctypes.c_void_p
        h = u.CreateDesktopW("hwpbatch", None, None, 0, 0x10000000, None)  # GENERIC_ALL
        if not h:
            raise OSError(f"CreateDesktopW 실패 {ctypes.get_last_error()}")
        u.SetThreadDesktop.argtypes = [ctypes.c_void_p]
        if not u.SetThreadDesktop(ctypes.c_void_p(h)):
            raise OSError(f"SetThreadDesktop 실패 {ctypes.GetLastError()}")
        try:
            work(src, n)
            done["ok"] = True
        except Exception as e:
            done["err"] = f"{type(e).__name__}: {e}"
    th = threading.Thread(target=runner); th.start(); th.join()
    mode = "별도 데스크톱"
    if "err" in done: print("  🔴 실패:", done["err"])
else:
    work(src, n); mode = "같은 데스크톱"

took = time.time() - started
stop.set(); time.sleep(0.4)
print(f"{mode} · {n}회: {took:.1f}초")
print(f"  변환 산출물: {len(SIZES)}개 · {SIZES}")
assert len(SIZES) == n and all(x > 10000 for x in SIZES), "변환이 실제로 안 됐다 — 아래 숫자는 무의미"
print(f"  🔴 포커스가 넘어간 횟수: {len(steals)}")
for nm, ti in steals[:6]: print(f"   · [{nm}] {ti}")
