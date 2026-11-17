import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  clearAddProjectCompletion,
  setAddProjectCompletion,
  takeAddProjectCompletion,
} from "./addProjectCompletion";

describe("addProjectCompletion", () => {
  it("hands the completion out once", () => {
    const completion = vi.fn();
    setAddProjectCompletion(completion);
    const taken = takeAddProjectCompletion();
    taken?.({ environmentId: EnvironmentId.make("e"), projectId: ProjectId.make("p") });
    expect(completion).toHaveBeenCalledOnce();
    expect(takeAddProjectCompletion()).toBeNull();
  });

  it("drops a completion the opener cleared", () => {
    setAddProjectCompletion(vi.fn());
    clearAddProjectCompletion();
    expect(takeAddProjectCompletion()).toBeNull();
  });
});
