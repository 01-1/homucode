/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

const separateLabels: Readonly<Partial<Record<string, string>>> = {
  MadoHomu: "Enable MadoHomu",
  Theme: "Themes",
  Subagents: "Prefer native subagents",
  "Project name in thread titles": "Project name in title prompt",
  "Thread title ID prefix": "Thread title IDs",
  "Set up building T3 Code": "Show Building T3 settings",
  "Keep Claude threads working during background commands":
    "Keep Claude threads working while background commands run",
};

test(
  "Setup choices lead to editable Settings controls",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("demo");
    await t3.open();
    const readOffers = (heading: string) =>
      browser.evaluate((title) => {
        const heading = [...document.querySelectorAll("h2")].find(
          (element) => element.textContent?.trim() === title,
        );
        const dialog = heading?.closest('[role="dialog"]');
        return [
          ...(dialog?.querySelectorAll(
            'label > span > span:first-child, [role="combobox"][aria-label]',
          ) ?? []),
        ].flatMap((element) => {
          const title = element.getAttribute("aria-label") ?? element.textContent?.trim();
          return title ? [title] : [];
        });
      }, heading);

    await expect(screen.getByRole("heading", "HomuCode features")).toBeVisible();
    const first = await readOffers("HomuCode features");
    await screen.getByRole("button", "Next").tap();
    await expect(screen.getByRole("heading", "Extra features")).toBeVisible();
    const extra = await readOffers("Extra features");
    await screen.getByRole("button", "Not now").tap();
    await expect(screen.getByRole("heading", "Extra features")).not.toBeVisible();
    await app.open("/settings/general");

    expect(first).toContain("Quick model");
    expect(extra).toContain("Resend unread steers after Stop");
    const search = screen.getByRole("combobox", "Search settings");
    const openSetting = async (query: string, label = query) => {
      await search.fill(query);
      await expect(screen.getByRole("option", label, { exact: false }).first()).toBeVisible();
      // The search field is filled programmatically, so activate its result without a pointer press.
      await browser.evaluate((title) => {
        const result = [
          ...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'),
        ].find((option) => option.querySelector("span.block")?.textContent?.trim() === title);
        if (!result) throw new Error(`Missing Settings search result: ${title}`);
        result.click();
        return true;
      }, label);
    };
    for (const query of [...first, ...extra, "Theme", "Device names"]) {
      const label = separateLabels[query] ?? query;
      await openSetting(query, label);
      await expect(browser).toHaveURL(
        query === "Theme" ? /\/settings\/appearance/ : /\/settings\/homucode/,
      );
      const row = `[data-slot="settings-row"]:has(h3:text-is(${JSON.stringify(label)}))`;
      if (query !== "Theme" && query !== "Device names") {
        await expect(browser.locator(row)).toHaveCount(1);
      }
      const target =
        query === "Theme"
          ? "#theme button[aria-pressed]"
          : query === "Device names"
            ? '#device-names input[aria-label="Device name"]'
            : `${row} :is([role="checkbox"], [role="switch"], [role="combobox"], button[aria-label="Quick model"])`;
      await expect(
        browser.locator(`${target}:not([disabled], [aria-disabled="true"], [inert] *)`).first(),
      ).toBeVisible();
      if (query === "Stay signed in for 30 days") {
        await app.screenshot("connect-session-setting");
      }
    }

    await openSetting("Set up building T3 Code", "Show Building T3 settings");
    const visibility = '#show-building-t3 [role="switch"]';
    await expect(browser.locator(visibility)).toBeVisible();
    await browser.evaluate((selector) => {
      const control = document.querySelector<HTMLElement>(selector);
      if (!control) throw new Error(`Missing Settings control: ${selector}`);
      control.click();
      return true;
    }, visibility);
    await openSetting("Cloud machine type");
    await expect(browser).toHaveURL(/\/settings\/homucode/);
    const chooser = '[role="status"] + div button';
    await expect(browser.locator(chooser).first()).toBeVisible();
    await browser.evaluate((selector) => {
      const control = document.querySelector<HTMLElement>(selector);
      if (!control) throw new Error(`Missing Settings control: ${selector}`);
      control.click();
      return true;
    }, chooser);
    await expect(browser.locator("#build-machine-type input:not([disabled])")).toBeVisible();
  },
);
