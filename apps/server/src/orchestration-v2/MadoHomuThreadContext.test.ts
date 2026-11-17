import { expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { madohomuThreadContext } from "./MadoHomuThreadContext.ts";

it("scopes MadoHomu context to enabled project threads, including title-only threads and cleared prompts", () => {
  const thread = {
    id: ThreadId.make("madohomu"),
    projectId: ProjectId.make("garden"),
    title: "Garden",
  };
  const settings = {
    madohomuEnabled: true,
    madohomuProjectId: thread.projectId,
    madohomuThreads: {},
  };
  expect(madohomuThreadContext(settings, thread)).toBe(
    'MadoHomu thread "Garden"\nIcon: lucide:message-circle',
  );
  expect(madohomuThreadContext({ ...settings, madohomuEnabled: false }, thread)).toBe("");
  expect(
    madohomuThreadContext({ ...settings, madohomuProjectId: ProjectId.make("other") }, thread),
  ).toBe("");
  expect(madohomuThreadContext(settings, { ...thread, title: "" })).toBe("");
  expect(
    madohomuThreadContext(
      { ...settings, madohomuThreads: { [thread.id]: { icon: null, prompt: "  Water plants  " } } },
      thread,
    ),
  ).toBe('MadoHomu thread "Garden"\nIcon: lucide:message-circle\nWater plants');
});
