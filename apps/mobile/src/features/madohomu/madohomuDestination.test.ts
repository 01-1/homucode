import {
  EnvironmentId,
  ProjectId,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  madoHomuEntryEnvironments,
  resolveMadoHomuDestination,
  saveMadoHomuProject,
} from "./madohomuDestination";

const a = EnvironmentId.make("a");
const b = EnvironmentId.make("b");
const c = EnvironmentId.make("c");
const projectId = ProjectId.make("same-project-id");

it("keeps the original anchor through two device switches and reopens on the latest host", async () => {
  const settings = new Map<
    EnvironmentId,
    Pick<ServerSettings, "madohomuEnabled" | "madohomuProjectId"> &
      Partial<Pick<ServerSettings, "madohomuDestinationEnvironmentId">>
  >(
    [a, b, c].map((environmentId) => [
      environmentId,
      { madohomuEnabled: environmentId === a, madohomuProjectId: projectId },
    ]),
  );
  const environments = () =>
    [b, c, a].map((environmentId) => ({ environmentId, settings: settings.get(environmentId)! }));
  const writes: Array<{ environmentId: EnvironmentId; patch: ServerSettingsPatch }> = [];
  const save = async (environmentId: EnvironmentId, patch: ServerSettingsPatch) => {
    writes.push({ environmentId, patch });
    settings.set(environmentId, { ...settings.get(environmentId)!, ...patch });
    return true;
  };

  expect(madoHomuEntryEnvironments(environments(), null)).toEqual([a]);
  expect(
    await saveMadoHomuProject(
      resolveMadoHomuDestination(environments(), null),
      a,
      {
        environmentId: b,
        projectId,
      },
      save,
    ),
  ).toBe(true);
  expect(madoHomuEntryEnvironments(environments(), null)).toEqual([b]);
  writes.length = 0;

  expect(
    await saveMadoHomuProject(
      resolveMadoHomuDestination(environments(), null),
      b,
      {
        environmentId: c,
        projectId,
      },
      save,
    ),
  ).toBe(true);
  expect(writes).toEqual([
    { environmentId: c, patch: { madohomuEnabled: true, madohomuProjectId: projectId } },
    { environmentId: a, patch: { madohomuDestinationEnvironmentId: c } },
  ]);
  expect(madoHomuEntryEnvironments(environments(), null)).toEqual([c]);
});

it("uses the primary pointer and keeps the previous destination when the anchor write fails", async () => {
  const environments = [
    { environmentId: b, settings: { madohomuEnabled: true, madohomuDestinationEnvironmentId: c } },
    { environmentId: a, settings: { madohomuEnabled: true, madohomuDestinationEnvironmentId: b } },
    { environmentId: c, settings: { madohomuEnabled: true } },
  ];
  const selection = resolveMadoHomuDestination(environments, a);
  expect(madoHomuEntryEnvironments(environments, a)).toEqual([b]);
  const writes: EnvironmentId[] = [];

  expect(
    await saveMadoHomuProject(selection, b, { environmentId: c, projectId }, async (id) => {
      writes.push(id);
      return id !== a;
    }),
  ).toBe(false);
  expect(writes).toEqual([c, a]);
  expect(madoHomuEntryEnvironments(environments, a)).toEqual([b]);

  writes.length = 0;
  expect(
    await saveMadoHomuProject(selection, b, { environmentId: c, projectId }, async (id) => {
      writes.push(id);
      return false;
    }),
  ).toBe(false);
  expect(writes).toEqual([c]);
});
