import type { StaticScreenProps } from "@react-navigation/native";
import { AddProjectNewScreen } from "./AddProjectScreen";

type AddProjectNewRouteParams = {
  readonly environmentId?: string | string[];
  /** Opened from MadoHomu, which stays on its own environment. */
  readonly lockEnvironment?: boolean;
};

export function AddProjectNewRoute({
  route,
}: StaticScreenProps<AddProjectNewRouteParams | undefined>) {
  return <AddProjectNewScreen {...(route.params ?? {})} />;
}
