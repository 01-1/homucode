import type { ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  type FrameInfo,
  measure,
  ReduceMotion,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { deriveThreadArrangementSizing } from "../../lib/layout";
import { NativeScrollViewMarker } from "../../native/NativeScrollViewMarker";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { threadDragGapOffset } from "../threads/threadDragGap";

export interface MadoHomuReorderThread {
  readonly id: ThreadId;
  readonly title: string;
  readonly leading: ReactNode;
}

export interface MadoHomuReorderSection {
  readonly id: string;
  readonly title: string;
  readonly threads: ReadonlyArray<MadoHomuReorderThread>;
}

type Slot = { readonly y: number; readonly sectionId: string; readonly index: number };
type Item =
  | {
      readonly type: "header";
      readonly key: string;
      readonly offset: number;
      readonly title: string;
    }
  | { readonly type: "empty"; readonly key: string; readonly offset: number }
  | {
      readonly type: "thread";
      readonly key: string;
      readonly offset: number;
      readonly sectionId: string;
      readonly index: number;
      readonly last: boolean;
      readonly thread: MadoHomuReorderThread;
    };

function layoutOf(
  sections: ReadonlyArray<MadoHomuReorderSection>,
  rowHeight: number,
  headerHeight: number,
) {
  const items: Item[] = [];
  const slots: Slot[] = [];
  let y = 0;
  for (const section of sections) {
    const count = section.threads.length;
    items.push({
      type: "header",
      key: `header:${section.id}`,
      offset: y,
      title: `${section.title} (${count})`,
    });
    y += headerHeight;
    if (count === 0) {
      slots.push({ y, sectionId: section.id, index: 0 });
      items.push({ type: "empty", key: `empty:${section.id}`, offset: y });
      y += rowHeight;
      continue;
    }
    section.threads.forEach((thread, index) => {
      slots.push({ y, sectionId: section.id, index });
      items.push({
        type: "thread",
        key: thread.id,
        offset: y,
        sectionId: section.id,
        index,
        last: index === count - 1,
        thread,
      });
      y += rowHeight;
    });
    slots.push({ y, sectionId: section.id, index: count });
  }
  const geometry = items.map((item) => `${item.key}@${item.offset}`).join("|");
  return { items, slots, version: `${rowHeight}:${headerHeight}:${geometry}` };
}

/** The slot whose landing spot, once the rows between close the gap, is nearest the dragged row. */
function nearestSlot(
  slots: ReadonlyArray<Slot>,
  source: number,
  rowHeight: number,
  center: number,
): number {
  "worklet";
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < slots.length; index++) {
    const y = slots[index]!.y;
    const gap = Math.abs((y <= source ? y + rowHeight / 2 : y - rowHeight / 2) - center);
    if (gap < distance) {
      best = index;
      distance = gap;
    }
  }
  return best;
}

interface DragValues {
  readonly version: SharedValue<string>;
  readonly source: SharedValue<number>;
  readonly insertion: SharedValue<number>;
  readonly lift: SharedValue<number>;
}

function ReorderItem(props: {
  readonly offset: number;
  readonly height: number;
  readonly rowHeight: number;
  readonly version: string;
  readonly drag: DragValues;
  readonly lifted: boolean;
  readonly children: ReactNode;
}) {
  const { offset, rowHeight, version } = props;
  const { version: dragVersion, source, insertion, lift } = props.drag;
  // Separate views, so the gap animation and the follow translation never write the same transform.
  const gap = useAnimatedStyle(() => {
    const live = dragVersion.value === version && source.value >= 0;
    const target = live ? threadDragGapOffset(offset, source.value, rowHeight, insertion.value) : 0;
    return {
      zIndex: live && source.value === offset ? 1 : 0,
      transform: [
        {
          translateY: live
            ? withTiming(target, { duration: 160, reduceMotion: ReduceMotion.System })
            : 0,
        },
      ],
    };
  });
  const follow = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: dragVersion.value === version && source.value === offset ? lift.value : 0,
      },
    ],
  }));
  return (
    <Reanimated.View style={[{ height: props.height }, gap]}>
      <Reanimated.View
        style={[{ flex: 1 }, follow]}
        className={props.lifted ? "rounded-xl border border-border bg-screen" : "bg-screen"}
      >
        {props.children}
      </Reanimated.View>
    </Reanimated.View>
  );
}

/**
 * Pinned and custom sections with drag handles. The drag runs on the UI thread; JS hears only
 * when it starts and where it drops, and the list stays as dropped until the new order renders.
 */
export function MadoHomuReorderList(props: {
  readonly sections: ReadonlyArray<MadoHomuReorderSection>;
  /** The other sections, shown dimmed below: they do not take drops. */
  readonly dimmed: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly bottomInset: number;
  /** Returns whether the drop changed anything; the list snaps back when it did not. */
  readonly onDrop: (threadId: ThreadId, sectionId: string, index: number) => boolean;
  readonly onStep: (threadId: ThreadId, direction: "up" | "down") => void;
}) {
  const { appearance } = useAppearancePreferences();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { rowHeight, headerHeight } = deriveThreadArrangementSizing({
    baseFontSize: appearance.baseFontSize,
    fontScale,
  });
  const fresh = layoutOf(props.sections, rowHeight, headerHeight);
  const { version } = fresh;
  // oxlint-disable-next-line react/memo-dependencies -- the geometry gestures and worklets read changes only with `version`; titles render from `fresh`
  const { items, slots } = useMemo(() => fresh, [version]);
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const contentRef = useAnimatedRef<Reanimated.View>();
  const dragVersion = useSharedValue("");
  const active = useSharedValue(false);
  const source = useSharedValue(-1);
  const insertion = useSharedValue(-1);
  const slot = useSharedValue(-1);
  const translation = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const scrolled = useSharedValue(0);
  const lift = useDerivedValue(() => translation.value + scrolled.value);
  const [liftedKey, setLiftedKey] = useState<string | null>(null);
  const drag = useMemo(
    () => ({ version: dragVersion, source, insertion, lift }),
    [dragVersion, source, insertion, lift],
  );
  // Edge bands that start auto-scrolling; iOS draws the header over the top of the list.
  const topBand = (Platform.OS === "ios" ? insets.top + 44 : 0) + rowHeight;
  const bottomBand = (Platform.OS === "ios" ? insets.bottom : 0) + rowHeight;

  const retarget = useMemo(
    () => () => {
      "worklet";
      const center = source.value + rowHeight / 2 + translation.value + scrolled.value;
      const next = nearestSlot(slots, source.value, rowHeight, center);
      if (next < 0 || next === slot.value) return;
      slot.value = next;
      insertion.value = slots[next]!.y;
    },
    [slots, rowHeight, source, translation, scrolled, slot, insertion],
  );

  const onFrame = useCallback(
    (frame: FrameInfo) => {
      "worklet";
      if (!active.value) return;
      const view = measure(scrollRef);
      const content = measure(contentRef);
      if (!view || !content) return;
      const offset = view.pageY - content.pageY;
      scrolled.value = offset - startOffset.value;
      const center =
        content.pageY + source.value + rowHeight / 2 + translation.value + scrolled.value;
      const top = view.pageY + topBand;
      const bottom = view.pageY + view.height - bottomBand;
      const speed =
        center < top
          ? -Math.min(1, (top - center) / rowHeight)
          : center > bottom
            ? Math.min(1, (center - bottom) / rowHeight)
            : 0;
      if (speed !== 0) {
        const step = speed * Math.min(frame.timeSincePreviousFrame ?? 16, 32) * 0.6;
        // Bounds from where the list already is, so a top inset never makes it jump.
        const next = Math.max(
          Math.min(offset, 0),
          Math.min(Math.max(offset, content.height - view.height), offset + step),
        );
        if (next !== offset) scrollTo(scrollRef, 0, next, false);
      }
      retarget();
    },
    [
      active,
      scrollRef,
      contentRef,
      scrolled,
      startOffset,
      source,
      translation,
      rowHeight,
      topBand,
      bottomBand,
      retarget,
    ],
  );
  // Runs only while a row is held.
  const autoScroll = useFrameCallback(onFrame, false);

  const reset = () => {
    active.value = false;
    autoScroll.setActive(false);
    source.value = -1;
    insertion.value = -1;
    translation.value = 0;
    scrolled.value = 0;
    setLiftedKey(null);
  };
  const began = (key: string) => {
    autoScroll.setActive(true);
    setLiftedKey(key);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };
  const finished = (
    threadId: ThreadId,
    from: { readonly sectionId: string; readonly index: number },
    to: { readonly sectionId: string; readonly index: number } | null,
    droppedVersion: string,
  ) => {
    autoScroll.setActive(false);
    const same = to !== null && to.sectionId === from.sectionId;
    const moved =
      to !== null &&
      droppedVersion === version &&
      !(same && (to.index === from.index || to.index === from.index + 1)) &&
      props.onDrop(threadId, to.sectionId, same && to.index > from.index ? to.index - 1 : to.index);
    // A drop that moved stays on screen until the new order renders and clears it below.
    if (!moved) reset();
  };
  const handlers = useRef({ began, finished });
  // oxlint-disable-next-line react/refs -- gestures are built once per layout; they call the latest handlers when they fire
  handlers.current = { began, finished };
  const [js] = useState(() => ({
    began: (key: string) => handlers.current.began(key),
    finished: (...args: Parameters<typeof finished>) => handlers.current.finished(...args),
  }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears a finished drag's offsets once the order it produced (or a failed save's rollback) renders
  useEffect(() => {
    // oxlint-disable-next-line react/exhaustive-effect-dependencies, react/set-state-in-effect -- reset only writes shared values and the lifted key
    reset();
  }, [version]);

  const gestures = useMemo(() => {
    const result = new Map<string, ReturnType<typeof Gesture.Pan>>();
    for (const item of items) {
      if (item.type !== "thread") continue;
      // Worklets copy what they capture, so they take scalars, never the row's React elements.
      const { key, offset } = item;
      const threadId = item.thread.id;
      const from = { sectionId: item.sectionId, index: item.index };
      result.set(
        key,
        // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
        Gesture.Pan()
          .enabled(!props.disabled)
          .minDistance(0)
          .shouldCancelWhenOutside(false)
          .onStart(() => {
            if (active.value) return;
            const view = measure(scrollRef);
            const content = measure(contentRef);
            active.value = true;
            dragVersion.value = version;
            source.value = offset;
            insertion.value = offset;
            slot.value = -1;
            translation.value = 0;
            scrolled.value = 0;
            startOffset.value = view && content ? view.pageY - content.pageY : 0;
            retarget();
            runOnJS(js.began)(key);
          })
          .onUpdate((event) => {
            if (!active.value || source.value !== offset) return;
            translation.value = event.translationY;
            retarget();
          })
          .onFinalize((_, success) => {
            if (!active.value || source.value !== offset) return;
            active.value = false;
            const target = success && slot.value >= 0 ? slots[slot.value] : undefined;
            runOnJS(js.finished)(
              threadId,
              from,
              target ? { sectionId: target.sectionId, index: target.index } : null,
              version,
            );
          }),
      );
    }
    return result;
  }, [
    items,
    slots,
    version,
    props.disabled,
    retarget,
    js,
    active,
    dragVersion,
    source,
    insertion,
    slot,
    translation,
    scrolled,
    startOffset,
    scrollRef,
    contentRef,
  ]);

  const scroll = (
    <Reanimated.ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: props.bottomInset }}
    >
      <Reanimated.View ref={contentRef} collapsable={false}>
        {fresh.items.map((item) => {
          const height = item.type === "header" ? headerHeight : rowHeight;
          const lifted = item.key === liftedKey;
          return (
            <ReorderItem
              key={item.key}
              offset={item.offset}
              height={height}
              rowHeight={rowHeight}
              version={version}
              drag={drag}
              lifted={lifted}
            >
              {item.type === "header" ? (
                <View className="flex-1 justify-end px-5 pb-2">
                  <Text className="text-sm font-t3-semibold text-foreground-muted">
                    {item.title}
                  </Text>
                </View>
              ) : item.type === "empty" ? (
                <View className="flex-1 justify-center px-5">
                  <Text className="text-sm text-foreground-muted">Drop a thread here.</Text>
                </View>
              ) : (
                <View
                  className={
                    lifted
                      ? "flex-1 flex-row items-center gap-3 pl-5"
                      : "flex-1 flex-row items-center gap-3 border-b border-border-subtle pl-5"
                  }
                >
                  {item.thread.leading}
                  <Text numberOfLines={2} className="flex-1 text-base">
                    {item.thread.title}
                  </Text>
                  <GestureDetector gesture={gestures.get(item.key)!}>
                    <View
                      collapsable={false}
                      accessible
                      accessibilityRole="adjustable"
                      accessibilityLabel={`Reorder ${item.thread.title}`}
                      accessibilityState={{ disabled: props.disabled }}
                      accessibilityActions={[
                        ...(item.index > 0 ? [{ name: "decrement", label: "Move up" }] : []),
                        ...(!item.last ? [{ name: "increment", label: "Move down" }] : []),
                      ]}
                      onAccessibilityAction={({ nativeEvent }) => {
                        if (props.disabled) return;
                        if (nativeEvent.actionName === "decrement" && item.index > 0)
                          props.onStep(item.thread.id, "up");
                        if (nativeEvent.actionName === "increment" && !item.last)
                          props.onStep(item.thread.id, "down");
                      }}
                      style={{
                        width: 56,
                        alignSelf: "stretch",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: props.disabled ? 0.3 : 1,
                      }}
                    >
                      <SymbolView
                        name="line.3.horizontal"
                        size={22}
                        tintColorClassName="accent-foreground-muted"
                      />
                    </View>
                  </GestureDetector>
                </View>
              )}
            </ReorderItem>
          );
        })}
      </Reanimated.View>
      <View pointerEvents="none" style={{ opacity: 0.4 }}>
        {props.dimmed.map((title) => (
          <View key={title} style={{ height: headerHeight }} className="justify-end px-5 pb-2">
            <Text className="text-sm font-t3-semibold text-foreground-muted">{title}</Text>
          </View>
        ))}
      </View>
    </Reanimated.ScrollView>
  );
  return Platform.OS === "ios" ? (
    <NativeScrollViewMarker style={{ flex: 1 }}>{scroll}</NativeScrollViewMarker>
  ) : (
    scroll
  );
}
