# App window size (0.6.7, front A)

Backlog item "Abrir a janela do app maior". `/cc` and the launcher open Chrome/Edge/Chromium with
`--app=<url> --new-window` and no size, so the window opens with Chrome's default app window size, which is
narrow (945x1060 on a 1920x1080 screen in the experiment below).

## Experiment (Chrome on Linux/Wayland, throwaway `--user-data-dir`, page logging `outerWidth/outerHeight`)

| Case | Result |
| --- | --- |
| Chrome not running, `--app … --window-size=1280,860` | 1280x860 |
| Chrome already running (started without the flag), `--app … --window-size=1000,700` | **ignored**: 945x1060 (Chrome's default) |
| Chrome started with `--window-size=1280,860`, later `--app … --window-size=1000,700`, later a plain tab | all 1280x860: the flag of the first launch is the size of every new window of that Chrome |
| `window.resizeTo(1100, 750)` from the page of an `--app` window | works: 1100x750 |
| `matchMedia('(display-mode: standalone)')` | `true` in an `--app` window, `false` in a tab (`browser`) |
| Resize with `resizeTo`, quit Chrome, open the `--app` window again | 945x1060: Chrome did not keep the size |

The usual case is a Chrome that is already running, so `--window-size` from the hook would almost never
apply, and when it does it also sizes the person's other Chrome windows. **Decision: the hook passes no
`--window-size`; the page sizes its own window with `window.resizeTo`.** The launchers (Linux `.desktop`,
Windows `.lnk`, macOS app) all run `open.mjs`, which opens the same page, so they need no change.

## Design

- `src/shared/windowSize.ts`: `DEFAULT_WINDOW_SIZE` 1280x860 (fits a 1440x900 screen), limits 480x480 to
  8192x8192, `normalizeWindowSize` (two finite numbers, rounded and clamped, anything else null) and
  `fitWindowSize` (shrinks to `screen.availWidth/availHeight`, never below the minimum).
- Config: optional `windowSize`, normalized on load (a hand-edited value is clamped or dropped).
- Hub: `PUT /api/window-size` with `{width, height}`. Same bearer token and the global Host/Origin check as
  every route, JSON content type only (415 otherwise), 400 for a body that is not two finite numbers. Saves
  only `windowSize`; `PUT /api/config` cannot change it. `GET /api/config` returns it.
- App (`ui/src/useWindowSize.ts`, used by `Shell`), only when `display-mode: standalone`:
  - A page that loaded with `#pair=` (a window just opened by `/cc` or the launcher, `api.openedByPair()`)
    reads the config and calls `window.resizeTo` with the saved size, or the default, fitted to the free area
    of the screen. Not on reloads, and not when the window already has that size.
  - On `resize`, after 1 s without changes, the outer size is sent to the hub, unless it equals the size the
    hub already has (or the one the page just set) or the window is maximized (outer size at least the free
    area of the screen), so a maximized window does not make the next one open screen-sized.
- Ordinary tabs (no Chrome: default browser, Safari) are not touched.

## Not done

- Window position: Wayland does not let a page or a flag place a window; on X11, Windows and macOS the
  window manager places it. Not remembered.
- No live check of `resizeTo` on Windows and macOS yet (see the live test).
