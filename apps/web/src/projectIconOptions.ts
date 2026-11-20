import * as Schema from "effect/Schema";
import {
  ProjectMonogramText,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { lucideIconNames } from "./lib/lucideIconByName";
import { deriveProjectIdentity } from "./projectIdentity";
export { PROJECT_ICON_COLORS, projectIconColorClassName } from "./projectIconColors";

const isProjectMonogramText = Schema.is(ProjectMonogramText);

export const PROJECT_ICON_CATEGORIES: ReadonlyArray<{
  readonly label: string;
  readonly icons: ReadonlyArray<string>;
}> = [
  {
    label: msg("Work"),
    icons: [
      "briefcase",
      "kanban",
      "list-todo",
      "clipboard-list",
      "calendar",
      "target",
      "flag",
      "trophy",
      "presentation",
      "chart-line",
      "chart-pie",
      "users",
      "message-square",
      "mail",
      "inbox",
      "megaphone",
      "handshake",
    ],
  },
  {
    label: msg("Code"),
    icons: [
      "folder-code",
      "code-2",
      "terminal",
      "braces",
      "bug",
      "git-branch",
      "git-pull-request",
      "git-merge",
      "git-commit-horizontal",
      "server",
      "database",
      "cpu",
      "bot",
      "sparkles",
      "workflow",
      "blocks",
      "puzzle",
      "cloud-cog",
    ],
  },
  {
    label: msg("Files"),
    icons: [
      "folder",
      "folder-open",
      "folder-git-2",
      "file",
      "file-text",
      "file-code",
      "files",
      "archive",
      "book-open",
      "notebook-pen",
      "bookmark",
      "image",
      "paperclip",
      "package",
    ],
  },
  {
    label: msg("Status"),
    icons: [
      "circle-check",
      "circle-alert",
      "circle-dot",
      "clock",
      "hourglass",
      "timer",
      "eye",
      "shield-check",
      "lock",
      "flame",
      "zap",
      "star",
      "heart",
      "pin",
      "bell",
    ],
  },
  {
    label: msg("Objects"),
    icons: [
      "rocket",
      "wrench",
      "cog",
      "lightbulb",
      "flask-conical",
      "key",
      "palette",
      "pen-tool",
      "camera",
      "music",
      "gamepad-2",
      "gift",
      "coffee",
      "shopping-bag",
      "brain",
    ],
  },
  {
    label: msg("Places"),
    icons: [
      "globe-2",
      "cloud",
      "smartphone",
      "monitor",
      "layers-3",
      "house",
      "map",
      "compass",
      "plane",
      "leaf",
      "sun",
      "moon",
    ],
  },
];

const ICON_KEYWORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  agent: ["bot", "sparkles", "brain"],
  ai: ["bot", "sparkles", "brain"],
  api: ["server", "braces", "workflow"],
  chat: ["message-square", "mail", "inbox"],
  data: ["database", "chart-line", "chart-pie"],
  deploy: ["rocket", "cloud", "package"],
  design: ["palette", "pen-tool", "image"],
  docs: ["book-open", "file-text", "notebook-pen"],
  done: ["circle-check", "trophy", "flag"],
  idea: ["lightbulb", "sparkles"],
  mobile: ["smartphone"],
  personal: ["heart", "house", "coffee"],
  pr: ["git-pull-request", "git-merge"],
  "pull request": ["git-pull-request", "git-merge"],
  release: ["rocket", "package", "flag"],
  review: ["eye", "git-pull-request", "message-square"],
  security: ["shield-check", "lock", "key"],
  settings: ["cog", "wrench"],
  task: ["list-todo", "clipboard-list", "circle-check"],
  test: ["flask-conical", "bug", "circle-check"],
  urgent: ["flame", "zap", "circle-alert"],
  wait: ["hourglass", "clock", "timer"],
  web: ["globe-2", "monitor"],
  work: ["briefcase", "kanban", "list-todo"],
};

export const MAX_ICON_RESULTS = 120;

export function filterProjectIconNames(query: string): ReadonlyArray<string> {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (tokens.length === 0) return PROJECT_ICON_CATEGORIES.flatMap((category) => category.icons);
  const phrase = tokens.join(" ");
  const exact = tokens.join("-");
  const keywordHits = Object.entries(ICON_KEYWORDS)
    .filter(([keyword]) => phrase.length > 1 && keyword.startsWith(phrase))
    .flatMap(([, names]) => names);
  const nameHits = lucideIconNames.filter((name) => tokens.every((token) => name.includes(token)));
  const rank = (name: string) => (name === exact ? 0 : name.startsWith(tokens[0] ?? "") ? 1 : 2);
  const ranked = nameHits.toSorted((a, b) => rank(a) - rank(b));
  const exactHits = ranked.filter((name) => name === exact);
  return [...new Set([...exactHits, ...keywordHits, ...ranked])].slice(0, MAX_ICON_RESULTS);
}

export const PROJECT_EMOJI_CATEGORIES: ReadonlyArray<{
  readonly label: string;
  readonly emojis: ReadonlyArray<{ readonly emoji: string; readonly label: string }>;
}> = [
  {
    label: msg("Work and tech"),
    emojis: [
      { emoji: "💻", label: msg("Computer") },
      { emoji: "🖥️", label: msg("Desktop") },
      { emoji: "⌨️", label: msg("Keyboard") },
      { emoji: "📱", label: msg("Mobile") },
      { emoji: "🤖", label: msg("Robot") },
      { emoji: "🧠", label: msg("Brain") },
      { emoji: "⚙️", label: msg("Gear") },
      { emoji: "🛠️", label: msg("Tools") },
      { emoji: "🔧", label: msg("Wrench") },
      { emoji: "🧪", label: msg("Test tube") },
      { emoji: "🗄️", label: msg("Database") },
      { emoji: "☁️", label: msg("Cloud") },
      { emoji: "📦", label: msg("Package") },
      { emoji: "🔒", label: msg("Lock") },
      { emoji: "🔑", label: msg("Key") },
      { emoji: "🐛", label: msg("Bug") },
    ],
  },
  {
    label: msg("Status"),
    emojis: [
      { emoji: "🚀", label: msg("Rocket") },
      { emoji: "✨", label: msg("Sparkles") },
      { emoji: "⚡", label: msg("Lightning") },
      { emoji: "🔥", label: msg("Fire") },
      { emoji: "💡", label: msg("Idea") },
      { emoji: "🎯", label: msg("Target") },
      { emoji: "✅", label: msg("Check") },
      { emoji: "⏳", label: msg("Hourglass") },
      { emoji: "📌", label: msg("Pin") },
      { emoji: "🚧", label: msg("Construction") },
      { emoji: "⭐", label: msg("Star") },
      { emoji: "🏁", label: msg("Finish flag") },
      { emoji: "📣", label: msg("Megaphone") },
      { emoji: "💬", label: msg("Speech bubble") },
      { emoji: "👀", label: msg("Eyes") },
      { emoji: "❤️", label: msg("Heart") },
    ],
  },
  {
    label: msg("Docs and data"),
    emojis: [
      { emoji: "📚", label: msg("Books") },
      { emoji: "📝", label: msg("Memo") },
      { emoji: "📄", label: msg("Page") },
      { emoji: "📁", label: msg("Folder") },
      { emoji: "🗂️", label: msg("Dividers") },
      { emoji: "📊", label: msg("Bar chart") },
      { emoji: "📈", label: msg("Chart") },
      { emoji: "🗓️", label: msg("Calendar") },
      { emoji: "📎", label: msg("Paperclip") },
      { emoji: "🔖", label: msg("Bookmark") },
    ],
  },
  {
    label: msg("Fun and life"),
    emojis: [
      { emoji: "🎮", label: msg("Game") },
      { emoji: "🎵", label: msg("Music") },
      { emoji: "🎬", label: msg("Movie") },
      { emoji: "🎨", label: msg("Palette") },
      { emoji: "📷", label: msg("Camera") },
      { emoji: "🛍️", label: msg("Shopping") },
      { emoji: "☕", label: msg("Coffee") },
      { emoji: "🍕", label: msg("Pizza") },
      { emoji: "🏠", label: msg("Home") },
      { emoji: "✈️", label: msg("Plane") },
      { emoji: "🌱", label: msg("Seedling") },
      { emoji: "🌍", label: msg("Globe") },
      { emoji: "🦄", label: msg("Unicorn") },
      { emoji: "🐙", label: msg("Octopus") },
      { emoji: "🐳", label: msg("Whale") },
      { emoji: "🦊", label: msg("Fox") },
    ],
  },
];

const MAX_EMOJI_LENGTH = 32;

// The server also rejects monograms longer than two graphemes (ProjectCommands.ts).
export function isValidProjectMonogram(text: string): boolean {
  if (!isProjectMonogramText(text)) return false;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  return Array.from(segments).length <= 2;
}

export function firstEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const segment = segments[Symbol.iterator]().next().value?.segment;
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(segment ?? "");
  const isKeycap = /^[#*0-9]️?⃣$/u.test(segment ?? "");
  if (
    !segment ||
    segment.length > MAX_EMOJI_LENGTH ||
    (!/\p{Extended_Pictographic}/u.test(segment) && !isFlag && !isKeycap)
  ) {
    return null;
  }
  return segment;
}

const DEFAULT_ICON = "folder-code";

export interface ProjectIconDraft {
  readonly mode: ProjectIconOverride["kind"];
  readonly iconName: string;
  readonly color: ProjectIconColor;
  readonly letters: string;
  readonly emoji: string;
}

export function initialProjectIconDraft(
  current: ProjectIconOverride | null,
  name: string,
): ProjectIconDraft {
  const automatic = deriveProjectIdentity(name);
  return {
    mode: current?.kind ?? "lucide",
    iconName: current?.kind === "lucide" ? current.name : DEFAULT_ICON,
    color: current && current.kind !== "emoji" ? current.color : automatic.color,
    letters: current?.kind === "monogram" ? current.text : automatic.monogram,
    emoji: current?.kind === "emoji" ? current.emoji : "💻",
  };
}

function normalizeMonogram(letters: string): string {
  return letters.normalize("NFKC").trim().toUpperCase();
}

/** Null when the monogram letters are not valid yet. */
export function projectIconFromDraft(draft: ProjectIconDraft): ProjectIconOverride | null {
  if (draft.mode === "lucide") return { kind: "lucide", name: draft.iconName, color: draft.color };
  if (draft.mode === "emoji") return { kind: "emoji", emoji: draft.emoji };
  const text = normalizeMonogram(draft.letters);
  return isValidProjectMonogram(text) ? { kind: "monogram", text, color: draft.color } : null;
}
