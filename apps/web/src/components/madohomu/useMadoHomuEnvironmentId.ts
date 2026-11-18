import { useAtomValue } from "@effect/atom-react";
import { useSearch } from "@tanstack/react-router";
import { madohomuDefaultEnvironmentIdAtom } from "../../madohomu";

export function useMadoHomuEnvironmentId() {
  const search = useSearch({ from: "/_chat/madohomu" });
  const destination = useAtomValue(madohomuDefaultEnvironmentIdAtom);
  return search.environmentId ?? destination;
}
