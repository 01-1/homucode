import { useSyncExternalStore } from "react";

// The header opens find and the thread body shows it, so the open thread lives outside both.
let openThreadKey: string | null = null;
const listeners = new Set<() => void>();

function setOpenThreadKey(next: string | null) {
  if (openThreadKey === next) return;
  openThreadKey = next;
  for (const listener of listeners) listener();
}

export function openThreadFind(threadKey: string): void {
  setOpenThreadKey(threadKey);
}

export function closeThreadFind(): void {
  setOpenThreadKey(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThreadFindOpen(threadKey: string): boolean {
  return useSyncExternalStore(subscribe, () => openThreadKey === threadKey);
}
