/// <reference lib="dom" />
import { expect } from "e2e";

import { SECOND_HOME, startSecondServer } from "./second-server.ts";
import { environmentId, makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Threads can move into an empty folder created from the sidebar",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("Local");
    const server = startSecondServer(app.baseUrl ?? "");
    try {
      const { host, token } = await server.ready;
      const remote = makeState(SECOND_HOME).state;
      const project = await remote.project("Remote");
      const first = await remote.thread({ project, title: "First thread", messages: ["Start"] });
      await remote.thread({ project, title: "Second thread", messages: ["Start"] });
      const remoteId = await runPromise(environmentId(host));

      await t3.open();
      const offers = screen.getByRole("dialog", "HomuCode features");
      await offers.getByRole("button", "Not now").waitFor();
      await browser.evaluate(() => {
        const dismiss = [
          ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
        ].find((button) => button.textContent?.trim() === "Not now");
        if (!dismiss) throw new Error("Missing onboarding dismissal");
        dismiss.click();
        return null;
      });
      await offers.waitFor({ state: "hidden" });
      await app.open(`/pair?host=${encodeURIComponent(host)}#token=${encodeURIComponent(token)}`);
      await screen.getByRole("button", "First thread", { exact: false }).first().waitFor();
      await app.open(`/${remoteId}/${first.threadId}`);

      const openMenu = (selector: string) =>
        browser.evaluate((selector) => {
          const target = document.querySelector(selector);
          if (!target) throw new Error(`Missing menu target: ${selector}`);
          const { left, top, width, height } = target.getBoundingClientRect();
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: left + width / 2,
              clientY: top + height / 2,
            }),
          );
          return null;
        }, selector);

      const clickMenuItem = (label: string) =>
        browser.evaluate((label) => {
          const item = [
            ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button'),
          ].find((button) => button.textContent?.trim() === label);
          if (!item) throw new Error(`Missing menu item: ${label}`);
          item.click();
          return null;
        }, label);

      await screen.getByRole("button", "First thread", { exact: false }).first().waitFor();
      await openMenu('[data-sidebar="group"]:has([data-sidebar-row][aria-label^="First thread"])');
      await screen.getByRole("menuitem", "New folder").waitFor();
      await clickMenuItem("New folder");
      const rename = screen.getByRole("textbox", "Folder name");
      await rename.fill("Filed work");
      await browser.evaluate(() => {
        document.querySelector<HTMLInputElement>('input[aria-label="Folder name"]')?.blur();
        return null;
      });
      await screen.getByRole("treeitem", "Filed work folder, 0 threads").waitFor();

      await openMenu('[data-sidebar-row][aria-label^="Second thread"]');
      await screen.getByRole("menuitem", "Move to folder").hover();
      const destination = screen.getByRole("menuitemradio", "Filed work");
      try {
        await expect(destination).toBeVisible({ timeout: 5_000 });
      } finally {
        await app.screenshot("move-to-folder");
      }
      await clickMenuItem("Filed work");
      await screen.getByRole("treeitem", "Filed work folder, 1 thread", { exact: false }).waitFor();

      const point = (selector: string) =>
        browser.evaluate((selector) => {
          const target = document.querySelector(selector);
          if (!target) throw new Error(`Missing drag target: ${selector}`);
          const { left, top, width, height } = target.getBoundingClientRect();
          return { x: left + width / 2, y: top + height / 2 };
        }, selector);
      const row = await point('[data-sidebar-row][aria-label^="First thread"]');
      const folder = await point('[data-testid="sidebar-thread-folder"]');
      await browser.mouse.move(row.x, row.y);
      await browser.mouse.down();
      await browser.mouse.move(row.x, row.y - 9);
      await browser.mouse.move(folder.x, folder.y);
      await browser.mouse.up();
      await app.screenshot("after-drop");
      await expect(
        screen.getByRole("treeitem", "Filed work folder, 2 threads", { exact: false }),
      ).toBeVisible();
    } finally {
      await server.stop();
    }
  },
);
