import type { StaticScreenProps } from "@react-navigation/native";
import { AddProjectSourceScreen } from "./AddProjectScreen";

type AddProjectSourceRouteParams = {
  readonly environmentId?: string | string[];
  /** Opened from MadoHomu, which stays on its own environment. */
  readonly lockEnvironment?: boolean;
};

export function AddProjectSourceRoute({
  route,
}: StaticScreenProps<AddProjectSourceRouteParams | undefined>) {
  return <AddProjectSourceScreen {...(route.params ?? {})} />;
}
