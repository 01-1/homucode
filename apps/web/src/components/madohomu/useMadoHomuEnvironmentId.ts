import { useAtomValue } from "@effect/atom-react";
import { useSearch } from "@tanstack/react-router";
import { madohomuDestinationEnvironmentIdAtom } from "../../madohomu";
import { usePrimaryEnvironmentId } from "../../state/environments";

export function useMadoHomuEnvironmentId() {
  const search = useSearch({ from: "/_chat/madohomu" });
  const primary = usePrimaryEnvironmentId();
  const destination = useAtomValue(madohomuDestinationEnvironmentIdAtom);
  return search.environmentId ?? destination ?? primary;
}
