import { ProjectId, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { isMadoHomuThreadRoute } from "../threads/thread-route-state";
import { madohomuLinkFlag, madohomuRouteFlag } from "./madohomuLinkFlag";

const projectId = ProjectId.make("madohomu");
const otherProjectId = ProjectId.make("another-project");
const source = { environmentId: "env", threadId: "parent" };
const child = { ...source, threadId: "child" };
const stack = (params: object) => ({
  index: 1,
  routes: [{ name: "Thread", params }, { name: "ThreadAgents" }],
});

const registry = vi.hoisted(() => ({ values: new Map<unknown, unknown>() }));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: (key: unknown) => registry.values.get(key),
    getNodes: () => registry.values,
  },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { configValueAtom: () => "config" },
}));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellAtom: (ref: ScopedThreadRef) => `shell:${ref.threadId}` },
  environmentThreads: { stateAtom: (_environmentId: unknown, id: ThreadId) => `detail:${id}` },
}));

function setup() {
  registry.values.clear();
  registry.values.set("config", {
    settings: { madohomuEnabled: true, madohomuProjectId: projectId },
  });
  return stack({ ...source, madohomu: true });
}

it("uses the local parent project for a missing shell and checks known targets first", () => {
  const state = setup();
  expect(madohomuLinkFlag(state, child, projectId)).toEqual({ madohomu: true });
  expect(madohomuLinkFlag(state, { ...child, environmentId: "linked" }, projectId)).toEqual({});
  registry.values.set("shell:child", { projectId: otherProjectId });
  expect(madohomuLinkFlag(state, child, projectId)).toEqual({});
});

it("resolves an unknown generic link from the destination detail and carries it to later links", () => {
  const state = setup();
  const params = madohomuLinkFlag(state, child);
  expect(params).toEqual({ madohomuLinkProjectId: projectId });
  const childStack = stack({ ...child, ...params });
  expect(isMadoHomuThreadRoute(params)).toBe(false);
  expect(isMadoHomuThreadRoute(params, otherProjectId)).toBe(false);
  expect(madohomuRouteFlag(childStack)).toEqual({});
  const loadDetail = (id: ProjectId) =>
    registry.values.set(
      "detail:child",
      AsyncResult.success({ data: Option.some({ thread: { projectId: id } }) }),
    );
  loadDetail(otherProjectId);
  expect(madohomuRouteFlag(childStack)).toEqual({});
  expect(madohomuLinkFlag(childStack, { ...child, threadId: "grandchild" })).toEqual({});
  loadDetail(projectId);
  expect(isMadoHomuThreadRoute(params, projectId)).toBe(true);
  expect(madohomuRouteFlag(childStack)).toEqual({ madohomu: true });
  expect(madohomuLinkFlag(childStack, { ...child, threadId: "grandchild" }, projectId)).toEqual({
    madohomu: true,
  });
});
