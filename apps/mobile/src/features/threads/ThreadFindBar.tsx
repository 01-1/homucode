import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Platform, type TextInputInstance, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { SearchField } from "../../components/ui/SearchField";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { closeThreadFind } from "./threadFindState";
import { requestThreadMessageJump } from "./threadMessageJump";

const QUERY_MAX_LENGTH = 200;

export function ThreadFindBar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadKey: string;
  readonly top: number;
}) {
  const inputRef = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState("");
  // null opens at the newest match once the count is known.
  const [index, setIndex] = useState<number | null>(null);
  const normalizedQuery = query.trim().slice(0, QUERY_MAX_LENGTH).trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 150);
  const settledQuery =
    debouncedQuery.length > 0 && debouncedQuery === normalizedQuery ? debouncedQuery : null;
  const targetKey = settledQuery === null ? null : JSON.stringify([settledQuery, index]);
  // Keeps the atom's identity for one request so a re-render does not refetch.
  const [stored, setStored] = useState(() => ({ key: targetKey, atom: findAtom(null) }));
  let atom = stored.atom;
  if (stored.key !== targetKey) {
    atom =
      settledQuery === null
        ? null
        : findAtom({
            environmentId: props.environmentId,
            input: {
              threadId: props.threadId,
              query: settledQuery,
              ...(index === null ? {} : { index }),
            },
          });
    setStored({ key: targetKey, atom });
  }
  const result = useEnvironmentQuery(atom);
  const data = settledQuery === null ? null : result.data;
  const total = data?.totalMatches ?? 0;
  if (index === null && data !== null && total > 0 && !result.isPending) setIndex(total - 1);

  const entryId = index !== null && !result.isPending ? data?.match?.entryId : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands each newly selected match to the thread's message jump store
  useEffect(() => {
    if (entryId !== undefined) requestThreadMessageJump(props.threadKey, entryId as MessageId);
  }, [entryId, props.threadKey]);

  const changeQuery = (next: string) => {
    setQuery(next);
    setIndex(null);
  };
  const step = (delta: number) => {
    if (total === 0 || index === null) return;
    setIndex((((index + delta) % total) + total) % total);
  };
  const searching = normalizedQuery.length > 0 && (settledQuery === null || result.isPending);
  const status =
    normalizedQuery.length === 0
      ? null
      : result.error !== null && settledQuery !== null
        ? "Error"
        : data === null || searching
          ? "…"
          : total === 0
            ? "0/0"
            : `${(index ?? total - 1) + 1}/${total}`;

  return (
    <View
      className={
        Platform.OS === "android"
          ? "absolute left-0 right-0 flex-row items-center gap-1 bg-thread-canvas px-3 py-2"
          : "absolute left-0 right-0 flex-row items-center gap-1 bg-screen px-3 py-2"
      }
      style={{ top: props.top }}
    >
      <SearchField
        inputRef={inputRef}
        accessibilityLabel="Find in thread"
        clearAccessibilityLabel="Clear find"
        placeholder="Find in thread"
        value={query}
        onChangeText={changeQuery}
      />
      {status !== null ? (
        <Text
          accessibilityLiveRegion="polite"
          className="min-w-10 text-center text-sm text-foreground-muted"
        >
          {status}
        </Text>
      ) : null}
      <IconButton
        accessibilityLabel="Previous match"
        icon="chevron.up"
        disabled={total === 0 || searching}
        onPress={() => step(-1)}
      />
      <IconButton
        accessibilityLabel="Next match"
        icon="chevron.down"
        disabled={total === 0 || searching}
        onPress={() => step(1)}
      />
      <IconButton accessibilityLabel="Close find" icon="xmark" onPress={closeThreadFind} />
    </View>
  );
}

function findAtom(target: Parameters<typeof orchestrationEnvironment.threadFind>[0] | null) {
  return target === null ? null : orchestrationEnvironment.threadFind(target);
}
