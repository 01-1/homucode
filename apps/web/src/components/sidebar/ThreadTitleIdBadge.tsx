/** The thread's short handle, unique on its server and shown before its title. */
export function ThreadTitleIdBadge({ titleId }: { readonly titleId?: string | null | undefined }) {
  if (!titleId) return null;
  return (
    <span className="me-1 font-mono tabular-nums opacity-70" aria-hidden="true">
      {titleId}
    </span>
  );
}
