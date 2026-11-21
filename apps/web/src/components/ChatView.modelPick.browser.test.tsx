import { createMemoryHistory } from "@tanstack/react-router";
import { ProviderInstanceId, UsageLimitSourceId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

// Its own file: the app's shell subscription outlives a test, and it must list this thread.
it("applies picks before sending and lets a cooling model receive queued messages", async () => {
  const stored = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
    options: [{ id: "reasoningEffort", value: "high" }],
  };
  const thread = { ...threadWithHistory("thread-model-pick", 1), modelSelection: stored };
  const aliasThread = {
    ...threadWithHistory("thread-model-alias", 1),
    modelSelection: { ...stored, model: "gpt-5-codex" },
  };
  const cooling = {
    ...threadWithHistory("thread-model-cooldown", 1),
    modelSelection: { ...stored, model: "gpt-6.2-sol" },
  };
  const endpoint = "http://127.0.0.1:8317";
  const checkedAt = "2026-11-21T05:00:00.000Z";
  const retryAt = "2026-11-21T05:02:00.000Z";
  using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
  vi.setSystemTime(Date.parse(checkedAt));
  using _environment = installFakeEnvironment([thread, aliasThread, cooling], {
    acceptCommands: true,
    providers: [{ ...CODEX_PROVIDER, auth: { ...CODEX_PROVIDER.auth, endpoint } }],
    usageLimitSources: [
      {
        id: UsageLimitSourceId.make("cooldown-hub"),
        kind: "cliproxy",
        label: "Cooldown hub",
        endpoint,
        checkedAt,
        accounts: [],
        codexModelCooldowns: [{ model: cooling.modelSelection.model, retryAt }],
      },
    ],
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Answer 0 for thread-model-pick.")).toBeVisible();

  const modelSets = () =>
    dispatchedCommands().filter((command) => command.type === "thread.model-selection.set");

  await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
  await page.getByRole("option", { name: /GPT-5\.5/ }).click();
  await vi.waitFor(() =>
    expect(modelSets()).toEqual([
      expect.objectContaining({
        threadId: thread.id,
        modelSelection: { instanceId: "codex", model: "gpt-5.5" },
      }),
    ]),
  );

  // A thread stored under an alias keeps its options when its canonical model is picked.
  await userEvent.keyboard("{Escape}");
  await router.navigate({ href: `/${ENVIRONMENT_ID}/${aliasThread.id}` });
  await expect.element(page.getByText("Answer 0 for thread-model-alias.")).toBeVisible();
  await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
  await page.getByRole("option", { name: /GPT-5\.4/ }).click();
  await vi.waitFor(() =>
    expect(modelSets().at(-1)).toEqual(
      expect.objectContaining({ threadId: aliasThread.id, modelSelection: stored }),
    ),
  );

  await userEvent.keyboard("{Escape}");
  await router.navigate({ href: `/${ENVIRONMENT_ID}/${cooling.id}` });
  await expect.element(page.getByText(/Model cooldown: .+/)).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /^gpt-6\.2-sol$/i }))
    .toHaveAccessibleDescription(/Model cooldown: .+/);
  await userEvent.click(page.getByTestId("composer-editor"));
  await userEvent.keyboard("Send after cooldown{Enter}");
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({
        type: "message.dispatch",
        threadId: cooling.id,
        modelSelection: expect.objectContaining({ model: cooling.modelSelection.model }),
        text: "Send after cooldown",
      }),
    ),
  );
});
