import { expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { duetThreadContext } from "./DuetThreadContext.ts";

it("scopes Duet context to enabled project threads, including title-only threads and cleared prompts", () => {
  const thread = {
    id: ThreadId.make("duet"),
    projectId: ProjectId.make("garden"),
    title: "Garden",
  };
  const settings = { duetEnabled: true, duetProjectId: thread.projectId, duetThreads: {} };
  expect(duetThreadContext(settings, thread)).toBe(
    'Duet thread "Garden"\nIcon: lucide:message-circle',
  );
  expect(duetThreadContext({ ...settings, duetEnabled: false }, thread)).toBe("");
  expect(duetThreadContext({ ...settings, duetProjectId: ProjectId.make("other") }, thread)).toBe(
    "",
  );
  expect(duetThreadContext(settings, { ...thread, title: "" })).toBe("");
  expect(
    duetThreadContext(
      { ...settings, duetThreads: { [thread.id]: { icon: null, prompt: "  Water plants  " } } },
      thread,
    ),
  ).toBe('Duet thread "Garden"\nIcon: lucide:message-circle\nWater plants');
});
