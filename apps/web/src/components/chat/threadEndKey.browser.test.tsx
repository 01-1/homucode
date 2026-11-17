import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { endKeyScrollsThread as endKeyScrollsThreadAt } from "./threadEndKey";

describe("endKeyScrollsThread", () => {
  it("takes End outside other scrollers and widgets", async () => {
    // Plain markup; the check reads only the DOM.
    await using screen = await render(
      <div>
        <button type="button" data-testid="loose">
          loose
        </button>
        <div className="messages-timeline-scroll" style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 400 }}>
            <div style={{ height: 50, overflowY: "auto" }}>
              <button type="button" data-testid="in-timeline">
                timeline
              </button>
            </div>
          </div>
        </div>
        <div style={{ height: 100, overflowY: "auto" }}>
          <button type="button" data-testid="in-panel" style={{ height: 400 }}>
            panel
          </button>
        </div>
        <div style={{ height: 100, overflowY: "auto" }}>
          <button type="button" data-testid="in-short-panel">
            short
          </button>
        </div>
        <div contentEditable suppressContentEditableWarning data-testid="composer-editor">
          <p>
            draft <span data-testid="mention">@file</span>
          </p>
        </div>
        <div data-thread-find-bar>
          <input data-testid="find" defaultValue="query" />
        </div>
        <input data-testid="other-field" defaultValue="x" />
        <div role="listbox">
          <div role="option" tabIndex={0} data-testid="option">
            option
          </div>
        </div>
      </div>,
      { router: false },
    );
    const at = (id: string) => screen.getByTestId(id).element();
    const endKeyScrollsThread = (target: EventTarget | null, timeStamp = 10_000, lastUnused = 0) =>
      endKeyScrollsThreadAt({ target, timeStamp }, lastUnused);

    expect(endKeyScrollsThread(document.body)).toBe(true);
    expect(endKeyScrollsThread(at("loose"))).toBe(true);
    expect(endKeyScrollsThread(at("in-timeline"))).toBe(true);
    expect(endKeyScrollsThread(at("in-short-panel"))).toBe(true);
    expect(endKeyScrollsThread(at("in-panel"))).toBe(false);
    expect(endKeyScrollsThread(at("option"))).toBe(false);

    const composer = at("composer-editor") as HTMLElement;
    composer.focus();
    const caretAt = (node: Node, offset: number) => window.getSelection()?.collapse(node, offset);
    caretAt(composer.querySelector("p")!.firstChild!, 2);
    expect(endKeyScrollsThread(composer)).toBe(false);
    caretAt(at("mention").firstChild!, 2);
    expect(endKeyScrollsThread(composer)).toBe(false);
    caretAt(composer.querySelector("p")!, composer.querySelector("p")!.childNodes.length);
    expect(endKeyScrollsThread(composer)).toBe(true);

    const find = at("find") as HTMLInputElement;
    find.setSelectionRange(2, 2);
    expect(endKeyScrollsThread(find)).toBe(false);
    find.setSelectionRange(5, 5);
    expect(endKeyScrollsThread(find)).toBe(true);

    const other = at("other-field") as HTMLInputElement;
    other.setSelectionRange(1, 1);
    expect(endKeyScrollsThread(other)).toBe(false);

    expect(endKeyScrollsThread(document.body, 10_499, 10_000)).toBe(false);
    expect(endKeyScrollsThread(document.body, 10_500, 10_000)).toBe(true);
  });
});
