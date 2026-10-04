import { useCallback, useEffect, useRef, useState } from 'react';

// A value shown for a moment, such as which answer was wrong, that clears itself.
// Flashing again restarts the moment.
export function useFlash<T>(ms: number): [T | null, (value: T) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback((next: T) => {
    clearTimeout(timer.current);
    setValue(next);
    timer.current = setTimeout(() => setValue(null), ms);
  }, [ms]);
  const clear = useCallback(() => { clearTimeout(timer.current); setValue(null); }, []);
  return [value, flash, clear];
}
