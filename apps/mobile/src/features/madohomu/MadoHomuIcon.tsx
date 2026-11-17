import IconBook from "@tabler/icons-react-native/IconBook";
import IconCalendar from "@tabler/icons-react-native/IconCalendar";
import IconCode from "@tabler/icons-react-native/IconCode";
import IconHeart from "@tabler/icons-react-native/IconHeart";
import IconInbox from "@tabler/icons-react-native/IconInbox";
import IconLeaf from "@tabler/icons-react-native/IconLeaf";
import IconListCheck from "@tabler/icons-react-native/IconListCheck";
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle";
import IconSun from "@tabler/icons-react-native/IconSun";
import { DEFAULT_MADOHOMU_ICON } from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";

export const MADOHOMU_ICONS = [
  { id: "lucide:message-circle", label: "Chat", component: IconMessageCircle },
  { id: "lucide:list-todo", label: "Tasks", component: IconListCheck },
  { id: "lucide:calendar-days", label: "Calendar", component: IconCalendar },
  { id: "lucide:inbox", label: "Inbox", component: IconInbox },
  { id: "lucide:code", label: "Code", component: IconCode },
  { id: "lucide:leaf", label: "Leaf", component: IconLeaf },
  { id: "lucide:heart", label: "Heart", component: IconHeart },
  { id: "lucide:book-open", label: "Book", component: IconBook },
  { id: "lucide:sun", label: "Sun", component: IconSun },
] as const;

export function MadoHomuIcon({
  icon,
  color,
  size = 20,
}: {
  readonly icon: string | null;
  readonly color: string;
  readonly size?: number;
}) {
  const choice = MADOHOMU_ICONS.find((item) => item.id === (icon ?? DEFAULT_MADOHOMU_ICON));
  return choice ? (
    <choice.component size={size} color={color} accessibilityLabel={choice.label} />
  ) : (
    <Text style={{ color, fontSize: size * 0.9, lineHeight: size }}>{icon}</Text>
  );
}
