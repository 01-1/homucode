import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../test/render";
import { Dialog, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { STRAY_INPUT_GUARD_MS, installStrayInputGuard } from "./strayInputGuard";

const settle = () => vi.advanceTimersByTime(2 * STRAY_INPUT_GUARD_MS);

it("drops presses on controls that appear or move under the pointer unasked, and at startup", async () => {
  const pressed = vi.fn();
  await using screen = await render(
    <div>
      <button type="button" onClick={() => pressed("top")}>
        Top
      </button>
      <button type="button" onClick={() => pressed("below")}>
        Below
      </button>
    </div>,
  );
  using _clock = fakeTimers();
  using _guard = installStrayInputGuard();
  const top = screen.getByRole("button", { name: "Top" });

  await userEvent.click(top);
  expect(pressed).not.toHaveBeenCalled();
  settle();
  await userEvent.click(top);
  expect(pressed.mock.calls).toEqual([["top"]]);

  // "Below" slides up under the resting pointer without being added.
  settle();
  (top.element() as HTMLElement).hidden = true;
  await commands.pressPointer();
  expect(pressed.mock.calls).toEqual([["top"]]);

  const added = document.createElement("button");
  added.textContent = "Added";
  added.addEventListener("click", () => pressed("added"));
  screen.container.append(added);
  await userEvent.click(added);
  expect(pressed.mock.calls).toEqual([["top"]]);
  vi.advanceTimersByTime(STRAY_INPUT_GUARD_MS);
  await userEvent.click(added);
  expect(pressed.mock.calls).toEqual([["top"], ["added"]]);

  // A control enabled in place by a background update is as new as one that appeared.
  added.disabled = true;
  settle();
  added.disabled = false;
  await userEvent.click(added);
  expect(pressed.mock.calls).toEqual([["top"], ["added"]]);
});

it("takes a press at once on what the user's own press opened", async () => {
  const picked = vi.fn();
  function Menu() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {open ? (
          <button type="button" onClick={picked}>
            Item
          </button>
        ) : null}
      </div>
    );
  }
  await using screen = await render(<Menu />);
  using _clock = fakeTimers();
  using _guard = installStrayInputGuard();
  settle();

  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  await userEvent.click(screen.getByRole("button", { name: "Item" }));
  expect(picked).toHaveBeenCalledTimes(1);
});

it("keeps an unprompted dialog open through an outside press or Escape just after it opens", async () => {
  const onOpenChange = vi.fn();
  const offer = (open: boolean) => (
    <div>
      <button type="button">Elsewhere</button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup data-unprompted>
          <DialogTitle>New features</DialogTitle>
        </DialogPopup>
      </Dialog>
    </div>
  );
  await using screen = await render(offer(false));
  using _clock = fakeTimers();
  using _guard = installStrayInputGuard();
  settle();

  // Unprompted even when the user's own press came just before.
  await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  await screen.rerender(offer(true));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.click(document.body, { position: { x: 2, y: 2 } });
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalled();

  settle();
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});

it("drops keys after focus moves unasked, but not after the user moves it", async () => {
  await using screen = await render(
    <div>
      <input aria-label="Composer" />
      <input aria-label="Popup field" />
    </div>,
  );
  using _clock = fakeTimers();
  using _guard = installStrayInputGuard();
  settle();
  const composer = screen.getByRole("textbox", { name: "Composer" });
  const popupField = screen.getByRole("textbox", { name: "Popup field" });

  await userEvent.click(composer);
  await userEvent.keyboard("a");
  settle();
  popupField.element().focus();
  await userEvent.keyboard("b");
  await expect.element(popupField).toHaveValue("");
  vi.advanceTimersByTime(STRAY_INPUT_GUARD_MS);
  await userEvent.keyboard("c");
  await expect.element(popupField).toHaveValue("c");

  await userEvent.click(composer);
  await userEvent.keyboard("d");
  await expect.element(composer).toHaveValue("ad");

  // Clicking back into the field you were typing in takes keys at once.
  settle();
  popupField.element().focus();
  await userEvent.click(composer);
  await userEvent.keyboard("e");
  await expect.element(composer).toHaveValue("ade");

  // An unprompted field that mounts and takes focus in one task, just after the user's press.
  const offer = document.createElement("div");
  offer.setAttribute("data-unprompted", "");
  const offerField = document.createElement("input");
  offer.append(offerField);
  screen.container.append(offer);
  offerField.focus();
  await userEvent.keyboard("f");
  expect(offerField.value).toBe("");
});

it("drops shortcut keys just after an unprompted surface appears, but not typing", async () => {
  const shortcut = vi.fn();
  document.addEventListener("keydown", shortcut);
  using _listener = { [Symbol.dispose]: () => document.removeEventListener("keydown", shortcut) };
  const view = (question: boolean) => (
    <div>
      <input aria-label="Composer" />
      {question ? (
        <div data-unprompted>
          <button type="button">Option</button>
        </div>
      ) : null}
    </div>
  );
  await using screen = await render(view(false));
  using _clock = fakeTimers();
  using _guard = installStrayInputGuard();
  settle();
  const composer = screen.getByRole("textbox", { name: "Composer" });
  await userEvent.click(composer);
  settle();

  await screen.rerender(view(true));
  await userEvent.keyboard("x{Enter}");
  await expect.element(composer).toHaveValue("x");
  expect(shortcut.mock.calls.map(([event]) => event.key)).toEqual(["x"]);

  vi.advanceTimersByTime(STRAY_INPUT_GUARD_MS);
  await userEvent.keyboard("{Enter}");
  expect(shortcut.mock.calls.map(([event]) => event.key)).toEqual(["x", "Enter"]);
});
