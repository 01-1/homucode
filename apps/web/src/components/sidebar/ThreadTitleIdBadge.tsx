/** The thread's short project-unique handle, shown before its title. */
export function ThreadTitleIdBadge({ titleId }: { readonly titleId?: string | null | undefined }) {
  if (!titleId) return null;
  return (
    <span className="me-1 font-mono tabular-nums opacity-70" aria-hidden="true">
      {titleId}
    </span>
  );
}
