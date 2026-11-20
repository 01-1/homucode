import { useGT } from "gt-react";
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Marks the search's menus and results, so using them keeps the search controls shown. */
const SIDEBAR_SEARCH_ATTRIBUTE = "data-sidebar-search";
export const SIDEBAR_SEARCH_PROPS = { [SIDEBAR_SEARCH_ATTRIBUTE]: "" };

export interface SidebarThreadHeaderProps {
  hasProjects: boolean;
  projectScope: ReactNode;
  /** Replaces the project scope and the new project and thread buttons while searching. */
  searchControls: ReactNode;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** A query or a list filter replaces the thread list. */
  isSearching: boolean;
  /** A query or any search filter is set. */
  canClearSearch: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  hasProjects,
  projectScope,
  searchControls,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  canClearSearch,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const gt = useGT();
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? gt("New thread ({shortcut})", { shortcut: newThreadShortcutLabel })
    : gt("New thread");
  // Focusing the field shows the search controls until a press or focus lands outside them.
  // Blur cannot decide that: Safari does not focus a pressed button, so a press on Filter
  // would read as leaving and swap the button away under the pointer.
  const [engaged, setEngaged] = useState(false);
  const searchMode = engaged || isSearching;
  const rowRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- presses and focus outside the header and its portaled menus never reach React handlers here
  useEffect(() => {
    if (!engaged) return;
    const leave = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (rowRef.current?.contains(target) ||
          (target instanceof Element && target.closest(`[${SIDEBAR_SEARCH_ATTRIBUTE}]`)))
      ) {
        return;
      }
      setEngaged(false);
    };
    document.addEventListener("pointerdown", leave, true);
    document.addEventListener("focusin", leave, true);
    return () => {
      document.removeEventListener("pointerdown", leave, true);
      document.removeEventListener("focusin", leave, true);
    };
  }, [engaged]);

  // Using the controls while filters alone keep them shown engages search too, so
  // clearing the last filter from the menu does not swap the menu away under it.
  const engageWhileSearching = () => {
    if (searchMode && !engaged) setEngaged(true);
  };

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-1"
      onPointerDownCapture={engageWhileSearching}
      onFocusCapture={engageWhileSearching}
    >
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring/70">
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onFocus={() => setEngaged(true)}
          // Picking a result keeps focus here, so a press must engage a field already focused.
          onPointerDown={() => setEngaged(true)}
          onKeyDown={(event) => {
            onSearchKeyDown(event);
            // With nothing left to clear, Escape leaves search.
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
              !canClearSearch
            ) {
              setEngaged(false);
              event.currentTarget.blur();
            }
          }}
          placeholder={gt("Search", { $context: "search field placeholder" })}
          aria-label={gt("Search threads")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {canClearSearch ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={gt("Clear thread search")}
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        {searchMode ? (
          searchControls
        ) : (
          <>
            {hasProjects ? (
              <>
                {projectScope}
                <SidebarHeaderIconButton label={gt("Add project")} onClick={onNewProject}>
                  <FolderPlusIcon />
                </SidebarHeaderIconButton>
              </>
            ) : null}
            <SidebarHeaderIconButton
              label={gt("New thread")}
              tooltip={
                showNewThreadInProjectHint ? (
                  <span className="flex flex-col gap-0.5">
                    <span>{newThreadLabel}</span>
                    <span className="text-muted-foreground">
                      {newThreadInProjectShortcutLabel
                        ? gt("New thread in current project: Shift+click ({shortcut})", {
                            shortcut: newThreadInProjectShortcutLabel,
                          })
                        : gt("New thread in current project: Shift+click")}
                    </span>
                  </span>
                ) : (
                  newThreadLabel
                )
              }
              disabled={newThreadDisabled}
              onClick={onNewThread}
            >
              <SquarePenIcon />
            </SidebarHeaderIconButton>
          </>
        )}
      </div>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
