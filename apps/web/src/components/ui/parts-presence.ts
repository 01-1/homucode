import { createContext, useContext, useLayoutEffect, useState } from "react";

/**
 * Lets descendants tell an ancestor which parts it holds, so the ancestor can expose data
 * attributes. This replaces ancestor-position `:has()` selectors, which make Chromium restyle
 * the whole document on every DOM change.
 */
export function createPartsPresence<Part extends string>() {
  const Context = createContext<((part: Part) => () => void) | null>(null);

  function usePart(part: Part, active = true) {
    const register = useContext(Context);
    // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports mount to the ancestor
    useLayoutEffect(() => (active ? register?.(part) : undefined), [register, part, active]);
  }

  function useParts() {
    const [counts, setCounts] = useState<Partial<Record<Part, number>>>({});
    const register = (part: Part) => {
      setCounts((current) => ({ ...current, [part]: (current[part] ?? 0) + 1 }));
      return () => setCounts((current) => ({ ...current, [part]: (current[part] ?? 1) - 1 }));
    };
    const has = (part: Part) => ((counts[part] ?? 0) > 0 ? "" : undefined);
    return { Provider: Context.Provider, register, has };
  }

  return { usePart, useParts };
}
