import {
  BookOpenIcon,
  CalendarDaysIcon,
  CodeIcon,
  HeartIcon,
  InboxIcon,
  LeafIcon,
  ListTodoIcon,
  MessageCircleIcon,
  SunIcon,
} from "lucide-react";
import { DEFAULT_MADOHOMU_ICON } from "@t3tools/contracts";
import { MADOHOMU_ICON_COLORS } from "@t3tools/client-runtime/madohomu";
import { ProviderAccentColorPicker } from "../settings/ProviderAccentColorPicker";
import { Input } from "../ui/input";

const ICONS = [
  { id: "lucide:message-circle", label: "Chat", component: MessageCircleIcon },
  { id: "lucide:list-todo", label: "Tasks", component: ListTodoIcon },
  { id: "lucide:calendar-days", label: "Calendar", component: CalendarDaysIcon },
  { id: "lucide:inbox", label: "Inbox", component: InboxIcon },
  { id: "lucide:code", label: "Code", component: CodeIcon },
  { id: "lucide:leaf", label: "Leaf", component: LeafIcon },
  { id: "lucide:heart", label: "Heart", component: HeartIcon },
  { id: "lucide:book-open", label: "Book", component: BookOpenIcon },
  { id: "lucide:sun", label: "Sun", component: SunIcon },
];

export function MadoHomuIcon({ icon, color }: { icon: string | null; color: string }) {
  const choice = ICONS.find((item) => item.id === (icon ?? DEFAULT_MADOHOMU_ICON));
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none"
      style={{ color }}
    >
      {choice ? (
        <choice.component className="size-4" aria-hidden />
      ) : (
        <span aria-hidden>{icon}</span>
      )}
    </span>
  );
}

export function MadoHomuIconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
}) {
  const usingEmoji = icon.trim() !== "" && !icon.startsWith("lucide:");
  const customColor = MADOHOMU_ICON_COLORS.some((swatch) => swatch === color.toLowerCase())
    ? undefined
    : color;
  return (
    <div className="grid gap-3">
      <span className="text-sm">Icon</span>
      <div className="flex flex-wrap gap-1">
        {ICONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={!usingEmoji && (icon.trim() || DEFAULT_MADOHOMU_ICON) === item.id}
            className="rounded-md p-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted"
            onClick={() => onIconChange(item.id)}
          >
            <item.component className="size-5" style={{ color }} />
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        <span className={usingEmoji ? "font-medium" : undefined}>
          {usingEmoji ? "Custom emoji (in use)" : "Custom emoji"}
        </span>
        <Input
          value={usingEmoji ? icon : ""}
          placeholder="Type an emoji to use it instead"
          maxLength={16}
          onChange={(event) => onIconChange(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Color</span>
        {MADOHOMU_ICON_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="size-8 rounded-full border-2 border-transparent aria-pressed:border-foreground sm:size-7"
            style={{ backgroundColor: swatch }}
            aria-label={`Icon color ${swatch}`}
            aria-pressed={color.toLowerCase() === swatch}
            onClick={() => onColorChange(swatch)}
          />
        ))}
        <ProviderAccentColorPicker
          displayName="MadoHomu icon"
          layout="inline"
          round
          value={customColor}
          onCommit={onColorChange}
        />
      </div>
    </div>
  );
}
