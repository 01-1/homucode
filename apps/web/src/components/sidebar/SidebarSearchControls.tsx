import {
  AlarmClockIcon,
  ArrowDownUpIcon,
  BotIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  FolderGitIcon,
  FolderIcon,
  InboxIcon,
  LayersIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  PinIcon,
  ServerIcon,
  TextIcon,
} from "lucide-react";
import { type ElementType, useState } from "react";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";

import {
  countSidebarSearchFilters,
  NO_SIDEBAR_SEARCH_FILTERS,
  SIDEBAR_SEARCH_SORT_OPTIONS,
  type SidebarSearchFeature,
  type SidebarSearchFilters,
  type SidebarSearchShelf,
  type SidebarSearchSort,
  type SidebarSearchStatus,
  type SidebarSearchUpdated,
} from "../Sidebar.logic";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SIDEBAR_SEARCH_PROPS, SidebarHeaderIconButton } from "./SidebarThreadHeader";

interface FilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
}

const STATUS_OPTIONS: ReadonlyArray<FilterOption<SidebarSearchStatus>> = [
  { value: "working", label: "Working", Icon: LoaderCircleIcon },
  { value: "needs-you", label: "Needs you", Icon: CircleAlertIcon },
  { value: "failed", label: "Failed", Icon: CircleXIcon },
  { value: "unread", label: "Unread", Icon: CircleDotIcon },
];

const SHELF_OPTIONS: ReadonlyArray<FilterOption<SidebarSearchShelf>> = [
  { value: "pinned", label: "Pinned", Icon: PinIcon },
  { value: "active", label: "Active", Icon: InboxIcon },
  { value: "snoozed", label: "Snoozed", Icon: AlarmClockIcon },
  { value: "settled", label: "Settled", Icon: CheckCheckIcon },
];

const UPDATED_OPTIONS: ReadonlyArray<FilterOption<SidebarSearchUpdated>> = [
  { value: "any", label: "Any time", Icon: LayersIcon },
  { value: "day", label: "Past day", Icon: ClockIcon },
  { value: "week", label: "Past week", Icon: ClockIcon },
  { value: "month", label: "Past month", Icon: ClockIcon },
  { value: "older", label: "Older than a month", Icon: ClockIcon },
];

const FEATURE_OPTIONS: ReadonlyArray<FilterOption<SidebarSearchFeature>> = [
  { value: "pull-request", label: "Has a pull request", Icon: PullRequestGlyph.pullRequest },
  { value: "worktree", label: "In a worktree", Icon: FolderGitIcon },
];

export interface SidebarSearchChoice {
  readonly value: string;
  readonly label: string;
}

export interface SidebarSearchProjectChoice extends SidebarSearchChoice {
  readonly project: ProjectFaviconProject;
}

function toggled<Value>(values: ReadonlyArray<Value>, value: Value, on: boolean): Value[] {
  return on ? [...values, value] : values.filter((candidate) => candidate !== value);
}

function selectionSummary(selected: ReadonlyArray<string>, labels: ReadonlyArray<string>) {
  if (selected.length === 0) return "Any";
  if (selected.length === 1) return labels[0] ?? "1 selected";
  return `${selected.length} selected`;
}

function FilterSubTrigger({
  Icon,
  label,
  summary,
}: {
  Icon: ElementType<{ className?: string }>;
  label: string;
  summary: string;
}) {
  return (
    <MenuSubTrigger>
      <Icon aria-hidden className="size-3.5" />
      <span className="flex-1">{label}</span>
      <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">{summary}</span>
    </MenuSubTrigger>
  );
}

function CheckboxFilterSubmenu<Value extends string>({
  label,
  Icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  Icon: ElementType<{ className?: string }>;
  options: ReadonlyArray<FilterOption<Value>>;
  selected: ReadonlyArray<Value>;
  onChange: (selected: Value[]) => void;
}) {
  return (
    <MenuSub>
      <FilterSubTrigger
        Icon={Icon}
        label={label}
        summary={selectionSummary(
          selected,
          options.filter((option) => selected.includes(option.value)).map((option) => option.label),
        )}
      />
      <MenuSubPopup {...SIDEBAR_SEARCH_PROPS}>
        {options.map((option) => (
          <MenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={(on) => onChange(toggled(selected, option.value, on))}
          >
            <span className="flex min-w-0 items-center gap-2">
              <option.Icon aria-hidden className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

function ProjectFilterChoices({
  projects,
  selectedKeys,
  onToggle,
  onClear,
}: {
  projects: ReadonlyArray<SidebarSearchProjectChoice>;
  selectedKeys: ReadonlyArray<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible =
    needle.length === 0
      ? projects
      : projects.filter((project) => project.label.toLocaleLowerCase().includes(needle));
  return (
    <>
      <MenuSearchInput
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search projects"
        aria-label="Search projects"
      />
      {needle.length === 0 ? (
        <MenuCheckboxItem checked={selectedKeys.length === 0} onCheckedChange={() => onClear()}>
          <span className="flex min-w-0 items-center gap-2">
            <FolderIcon aria-hidden className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">All projects</span>
          </span>
        </MenuCheckboxItem>
      ) : null}
      {visible.length === 0 ? <MenuItem disabled>No matching projects</MenuItem> : null}
      {visible.map((project) => (
        <MenuCheckboxItem
          key={project.value}
          checked={selectedKeys.includes(project.value)}
          onCheckedChange={() => onToggle(project.value)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProjectFavicon project={project.project} className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{project.label}</span>
          </span>
        </MenuCheckboxItem>
      ))}
    </>
  );
}

function ChoiceFilterSubmenu({
  label,
  Icon,
  choices,
  selected,
  onChange,
}: {
  label: string;
  Icon: ElementType<{ className?: string }>;
  choices: ReadonlyArray<SidebarSearchChoice>;
  selected: ReadonlyArray<string>;
  onChange: (selected: string[]) => void;
}) {
  return (
    <CheckboxFilterSubmenu
      label={label}
      Icon={Icon}
      options={choices.map((choice) => ({ ...choice, Icon }))}
      selected={selected}
      onChange={onChange}
    />
  );
}

function FilterMenuContent({
  filters,
  onFiltersChange,
  projects,
  selectedProjectKeys,
  onToggleProject,
  onClearProjects,
  threadChoices,
}: SidebarSearchFilterMenuProps) {
  const update = (next: Partial<SidebarSearchFilters>) => onFiltersChange({ ...filters, ...next });
  const selectedProjectLabels = projects
    .filter((project) => selectedProjectKeys.includes(project.value))
    .map((project) => project.label);
  const { providers, environments } = threadChoices();
  const updated = UPDATED_OPTIONS.find((option) => option.value === filters.updated);
  const hasFilters = countSidebarSearchFilters(filters) + selectedProjectKeys.length > 0;
  return (
    <>
      <MenuSub>
        <FilterSubTrigger
          Icon={FolderIcon}
          label="Project"
          summary={
            selectedProjectKeys.length === 0
              ? "All"
              : selectionSummary(selectedProjectKeys, selectedProjectLabels)
          }
        />
        <MenuSubPopup {...SIDEBAR_SEARCH_PROPS}>
          <ProjectFilterChoices
            projects={projects}
            selectedKeys={selectedProjectKeys}
            onToggle={onToggleProject}
            onClear={onClearProjects}
          />
        </MenuSubPopup>
      </MenuSub>
      <CheckboxFilterSubmenu
        label="Status"
        Icon={CircleDotIcon}
        options={STATUS_OPTIONS}
        selected={filters.statuses}
        onChange={(statuses) => update({ statuses })}
      />
      <CheckboxFilterSubmenu
        label="Shelf"
        Icon={InboxIcon}
        options={SHELF_OPTIONS}
        selected={filters.shelves}
        onChange={(shelves) => update({ shelves })}
      />
      <MenuSub>
        <FilterSubTrigger
          Icon={ClockIcon}
          label="Last activity"
          summary={updated?.label ?? "Any time"}
        />
        <MenuSubPopup {...SIDEBAR_SEARCH_PROPS}>
          <MenuRadioGroup
            value={filters.updated}
            onValueChange={(next) => update({ updated: next as SidebarSearchUpdated })}
          >
            {UPDATED_OPTIONS.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                <span className="flex min-w-0 items-center gap-2">
                  <option.Icon aria-hidden className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubPopup>
      </MenuSub>
      {providers.length > 1 || filters.providers.length > 0 ? (
        <ChoiceFilterSubmenu
          label="Provider"
          Icon={BotIcon}
          choices={providers}
          selected={filters.providers}
          onChange={(providers) => update({ providers })}
        />
      ) : null}
      {environments.length > 1 || filters.environments.length > 0 ? (
        <ChoiceFilterSubmenu
          label="Server"
          Icon={ServerIcon}
          choices={environments}
          selected={filters.environments}
          onChange={(environments) => update({ environments })}
        />
      ) : null}
      <MenuSeparator />
      {FEATURE_OPTIONS.map((option) => (
        <MenuCheckboxItem
          key={option.value}
          checked={filters.features.includes(option.value)}
          onCheckedChange={(on) =>
            update({ features: toggled(filters.features, option.value, on) })
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <option.Icon aria-hidden className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
          </span>
        </MenuCheckboxItem>
      ))}
      <MenuCheckboxItem
        checked={filters.titlesOnly}
        onCheckedChange={(titlesOnly) => update({ titlesOnly })}
      >
        <span className="flex min-w-0 items-center gap-2">
          <TextIcon aria-hidden className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">Don't search messages</span>
        </span>
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuItem
        disabled={!hasFilters}
        onClick={() => {
          onFiltersChange(NO_SIDEBAR_SEARCH_FILTERS);
          if (selectedProjectKeys.length > 0) onClearProjects();
        }}
      >
        Clear filters
      </MenuItem>
    </>
  );
}

export interface SidebarSearchFilterMenuProps {
  filters: SidebarSearchFilters;
  onFiltersChange: (filters: SidebarSearchFilters) => void;
  projects: ReadonlyArray<SidebarSearchProjectChoice>;
  selectedProjectKeys: ReadonlyArray<string>;
  onToggleProject: (key: string) => void;
  onClearProjects: () => void;
  /** Read only while the menu is open, since it walks every listed thread. */
  threadChoices: () => {
    readonly providers: ReadonlyArray<SidebarSearchChoice>;
    readonly environments: ReadonlyArray<SidebarSearchChoice>;
  };
}

function ActiveCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-3xs leading-none font-semibold text-primary-foreground tabular-nums"
    >
      {count}
    </span>
  );
}

export function SidebarSearchFilterMenu(props: SidebarSearchFilterMenuProps) {
  const count = countSidebarSearchFilters(props.filters) + props.selectedProjectKeys.length;
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label={count > 0 ? `Filter threads (${count} active)` : "Filter threads"}
          />
        }
      >
        <ListFilterIcon className="size-4" />
        <ActiveCount count={count} />
      </MenuTrigger>
      <MenuPopup {...SIDEBAR_SEARCH_PROPS} align="end">
        <FilterMenuContent {...props} />
      </MenuPopup>
    </Menu>
  );
}

export function SidebarSearchSortMenu({
  sort,
  onSortChange,
}: {
  sort: SidebarSearchSort;
  onSortChange: (sort: SidebarSearchSort) => void;
}) {
  const current =
    SIDEBAR_SEARCH_SORT_OPTIONS.find((option) => option.value === sort) ??
    SIDEBAR_SEARCH_SORT_OPTIONS[0]!;
  return (
    <Menu>
      <MenuTrigger render={<SidebarHeaderIconButton label={`Sort threads: ${current.label}`} />}>
        <ArrowDownUpIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup {...SIDEBAR_SEARCH_PROPS} align="end">
        <MenuRadioGroup
          value={sort}
          onValueChange={(next) => onSortChange(next as SidebarSearchSort)}
        >
          <MenuGroupLabel>Sort results by</MenuGroupLabel>
          {SIDEBAR_SEARCH_SORT_OPTIONS.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
