/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Files follows /cd and a right-click project move",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const source = await t3.project("Source folder", { "source-only.txt": "source" });
    const destination = await t3.project("Destination folder", {
      "destination-only.txt": "target",
    });
    const thread = await t3.thread({
      project: source,
      title: "Moving thread",
      messages: ["Start"],
    });
    // This scenario drives the app's handlers without racing its stray input guard.
    const click = (selector: string, text: string | null = null) =>
      browser.evaluate(
        ({ selector, text }) => {
          const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(
            (button) => text === null || button.textContent?.replace(/\s/g, "") === text,
          );
          if (!button) throw new Error(`Missing button: ${text ?? selector}`);
          button.click();
          return null;
        },
        { selector, text },
      );

    await t3.open(thread);
    const offers = screen.getByRole("dialog", "HomuCode features");
    await offers.getByRole("button", "Not now").waitFor();
    await click('[role="dialog"] button', "Notnow");
    await offers.waitFor({ state: "hidden" });

    await screen.getByRole("button", "Toggle right panel").waitFor();
    await click('button[aria-label="Toggle right panel"]');
    await screen.getByRole("button", "Files F").waitFor();
    await click("button", "FilesF");
    await screen.getByRole("treeitem", "source-only.txt").waitFor();

    const composer = screen.getByRole("textbox");
    await composer.fill(`/cd "${destination}"`);
    await screen.getByRole("button", "Submit message").waitFor();
    await click('button[aria-label="Submit message"]');
    await expect(screen.getByRole("treeitem", "destination-only.txt")).toBeVisible();

    await screen.getByRole("button", "Moving thread", { exact: false }).first().waitFor();
    await browser.evaluate(() => {
      const row = document.querySelector('[data-sidebar-row][aria-label^="Moving thread"]');
      if (!row) throw new Error("Missing thread row");
      const { left, top, width, height } = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: left + width / 2,
          clientY: top + height / 2,
        }),
      );
      return null;
    });
    await screen.getByRole("menuitem", "Move to project").hover();
    await screen.getByRole("menuitem", "Source folder").waitFor();
    await click('[role="menu"][aria-label="Move to project"] button', "Sourcefolder");
    await screen.getByRole("button", "New thread in Source folder").waitFor();
    await app.screenshot("after-moving-back");
    await expect(screen.getByRole("treeitem", "source-only.txt")).toBeVisible();
  },
);
