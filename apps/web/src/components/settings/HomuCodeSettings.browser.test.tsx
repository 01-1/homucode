import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/index.css";
import "./HomuCodeSettings";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { installFakeEnvironment, type FakeDriver } from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

it("keeps device preferences usable when the linked environment is unavailable", async () => {
  using _environment = installFakeEnvironment([]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({
      initialEntries: ["/settings/homucode?machine=removed#user-message-markdown"],
    }),
  );
  await router.load();
  // Exercise the real Settings route and scope boundary.
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText("This environment is no longer available.")).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Format sent messages as Markdown" });
  expect(toggle.query()).not.toBeNull();
  await expect.element(toggle).toBeChecked();
  await userEvent.click(toggle);
  await expect.element(toggle).not.toBeChecked();
  await expect
    .element(page.getByRole("switch", { name: "Show Building T3 settings" }))
    .not.toBeInTheDocument();
});
