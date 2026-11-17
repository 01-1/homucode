import { useAtomValue } from "@effect/atom-react";
import { madohomuDestinationEnvironmentIdAtom } from "../../madohomu";
import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { MadoHomuIcon } from "./MadoHomuIcon";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  madohomuIconColor,
  madohomuTaskLabel,
  orderMadoHomuTasks,
} from "@t3tools/client-runtime/madohomu";
import { ProjectId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { useMadoHomuActions } from "./useMadoHomuActions";

function useMadoHomuEnvironmentId() {
  const search = useSearch({ from: "/_chat/madohomu" });
  const primary = usePrimaryEnvironmentId();
  const destination = useAtomValue(madohomuDestinationEnvironmentIdAtom);
  return search.environmentId ?? destination ?? primary;
}

export function MadoHomuProjectPicker({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const projects = useProjects().filter(
    (p) => p.environmentId === environmentId && p.archivedAt === null,
  );
  return (
    <label className="grid gap-2 text-sm">
      Project
      <select
        aria-label="MadoHomu project"
        className="rounded-md border bg-background p-2"
        disabled={!actions.canWrite}
        value={actions.settings.madohomuProjectId ?? ""}
        onChange={(event) =>
          void actions.changeProject(event.target.value ? ProjectId.make(event.target.value) : null)
        }
      >
        <option value="">Choose a project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MadoHomuPage() {
  const environmentId = useMadoHomuEnvironmentId();
  return environmentId ? (
    <MadoHomuWorkspace environmentId={environmentId} />
  ) : (
    <SidebarInset>
      <p className="p-6">Connect to an environment to use MadoHomu.</p>
    </SidebarInset>
  );
}

function MadoHomuWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const { settings, project } = useMadoHomuActions(environmentId);
  const search = useSearch({ from: "/_chat/madohomu" });
  const navigate = useNavigate();
  const threads = useVisibleThreadShells().filter(
    (t) =>
      t.environmentId === environmentId &&
      t.projectId === project?.id &&
      t.deletedAt === null &&
      t.archivedAt === null,
  );
  const selected = threads.find((t) => t.id === search.threadId) ?? threads[0];
  const open = (threadId: ThreadId) =>
    void navigate({ to: "/madohomu", search: { environmentId, threadId, tab: "chat" } });
  if (!settings.madohomuEnabled)
    return (
      <SidebarInset>
        <div className="p-6">
          Enable MadoHomu in{" "}
          <Link to="/settings/general" hash="madohomu-enabled">
            Settings → MadoHomu
          </Link>
          .
        </div>
      </SidebarInset>
    );
  if (!project)
    return (
      <SidebarInset>
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
          <h1 className="text-xl font-semibold">MadoHomu</h1>
          <p>Choose the project MadoHomu focuses on.</p>
          <MadoHomuProjectPicker environmentId={environmentId} />
        </div>
      </SidebarInset>
    );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b p-2 [-webkit-app-region:drag]">
        <div className="[-webkit-app-region:no-drag]">
          <SidebarTrigger />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm">{project.title}</span>
        {isElectron && window.desktopBridge?.setMadoHomuWindowMode ? (
          <div className="[-webkit-app-region:no-drag]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const bridge = window.desktopBridge;
                if (bridge)
                  void bridge
                    .setMadoHomuWindowMode?.({
                      mode: bridge.isMadoHomuWindow?.() ? "merged" : "split",
                      environmentId,
                      ...(selected ? { threadId: selected.id } : {}),
                      tab: search.tab ?? "chat",
                    })
                    .catch(() =>
                      toastManager.add({ type: "error", title: "Could not move MadoHomu" }),
                    );
              }}
            >
              {window.desktopBridge.isMadoHomuWindow?.() ? "Merge" : "Split"}
            </Button>
          </div>
        ) : null}
        <div
          role="tablist"
          aria-label="MadoHomu"
          className="flex gap-1 [-webkit-app-region:no-drag]"
        >
          {(["chat", "tasks"] as const).map((tab) => (
            <Button
              key={tab}
              role="tab"
              aria-selected={(search.tab ?? "chat") === tab}
              variant={(search.tab ?? "chat") === tab ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void navigate({ to: "/madohomu", search: { ...search, tab } })}
            >
              {tab === "chat" ? "Chat" : "Tasks"}
            </Button>
          ))}
        </div>
      </header>
      {search.tab === "tasks" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <h1 className="mb-3 text-lg font-semibold">Tasks</h1>
          {orderMadoHomuTasks(threads).map((thread) => (
            <button
              key={thread.id}
              className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted"
              onClick={() => open(thread.id)}
            >
              <MadoHomuIcon
                icon={settings.madohomuThreads[thread.id]?.icon ?? null}
                color={madohomuIconColor(thread.id, settings.madohomuThreads[thread.id]?.color)}
              />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="text-xs text-muted-foreground">{madohomuTaskLabel(thread)}</span>
            </button>
          ))}
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Create a thread to get started.</p>
          ) : null}
        </div>
      ) : selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatView environmentId={environmentId} threadId={selected.id} routeKind="server" />
        </div>
      ) : (
        <p className="p-6">Create a thread in the sidebar to start chatting.</p>
      )}
    </SidebarInset>
  );
}
