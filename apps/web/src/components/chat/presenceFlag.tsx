import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

type Register = () => () => void;

/**
 * Lets a descendant tell an ancestor it is mounted, so the ancestor can expose a data attribute.
 * This replaces ancestor-position `:has()` selectors, which make Chromium restyle the document.
 */
export function createPresenceFlag() {
  const Context = createContext<Register | null>(null);

  function Host({ children }: { readonly children: (present: boolean) => ReactNode }) {
    const [count, setCount] = useState(0);
    const register: Register = () => {
      setCount((c) => c + 1);
      return () => setCount((c) => c - 1);
    };
    return <Context.Provider value={register}>{children(count > 0)}</Context.Provider>;
  }

  function usePresence(active = true) {
    const register = useContext(Context);
    // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports mount to an ancestor host
    useLayoutEffect(() => (active && register ? register() : undefined), [active, register]);
  }

  return { Host, usePresence };
}
