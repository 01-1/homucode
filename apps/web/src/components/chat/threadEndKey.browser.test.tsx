import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { endKeyScrollsThread } from "./threadEndKey";

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
        <div role="listbox">
          <div role="option" tabIndex={0} data-testid="option">
            option
          </div>
        </div>
      </div>,
      { router: false },
    );
    const at = (id: string) => screen.getByTestId(id).element();

    expect(endKeyScrollsThread(document.body)).toBe(true);
    expect(endKeyScrollsThread(at("loose"))).toBe(true);
    expect(endKeyScrollsThread(at("in-timeline"))).toBe(true);
    expect(endKeyScrollsThread(at("in-short-panel"))).toBe(true);
    expect(endKeyScrollsThread(at("in-panel"))).toBe(false);
    expect(endKeyScrollsThread(at("option"))).toBe(false);
  });
});
