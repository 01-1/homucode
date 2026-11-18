import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

export type AddProjectCompletion = (project: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) => void;

let pending: AddProjectCompletion | null = null;

/**
 * Makes the next project the add-project flow ends on go to `completion` instead of a
 * new task draft. The opener clears it with `clearAddProjectCompletion` when it is
 * shown again, so backing out of the flow leaves later flows untouched.
 */
export function setAddProjectCompletion(completion: AddProjectCompletion): void {
  pending = completion;
}

export function clearAddProjectCompletion(): void {
  pending = null;
}

export function takeAddProjectCompletion(): AddProjectCompletion | null {
  const completion = pending;
  pending = null;
  return completion;
}
