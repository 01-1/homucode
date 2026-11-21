import { createPartsPresence } from "./parts-presence";

export const inputGroupParts = createPartsPresence<
  "control" | "inline-start" | "inline-end" | "block-start" | "block-end"
>();
