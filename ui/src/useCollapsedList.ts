import { useCallback, useEffect, useState } from 'react';

const KEY = 'acc.sessionsCollapsed';
const DESKTOP = '(min-width: 768px)';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function write(v: boolean) {
  try {
    window.localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: the choice only lasts for this page */
  }
}

/** Whether the viewport is md+; assumed true where matchMedia is missing. */
function useDesktop(): boolean {
  const mq = () => (typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP) : null);
  const [desktop, setDesktop] = useState(() => mq()?.matches ?? true);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const on = () => setDesktop(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return desktop;
}

/** Collapsed state of the session list, remembered in localStorage. Only effective on md+ screens. */
export function useCollapsedList(): [boolean, () => void] {
  const [stored, setStored] = useState(read);
  const desktop = useDesktop();
  const toggle = useCallback(() => {
    setStored((c) => {
      write(!c);
      return !c;
    });
  }, []);
  return [stored && desktop, toggle];
}
