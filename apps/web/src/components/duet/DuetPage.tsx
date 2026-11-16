import { useAtomValue } from "@effect/atom-react";
import { duetDestinationEnvironmentIdAtom } from "../../duet";
import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { DuetIcon, DuetIconPicker } from "./DuetIcon";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { duetIconColor, duetTaskLabel, orderDuetTasks } from "@t3tools/client-runtime/duet";
import {
  AuthOrchestrationOperateScope,
  DUET_THREAD_PROMPT_MAX_LENGTH,
  ProjectId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { useDuetActions } from "./useDuetActions";

function useDuetEnvironmentId() {
  const search = useSearch({ from: "/_chat/duet" });
  const primary = usePrimaryEnvironmentId();
  const destination = useAtomValue(duetDestinationEnvironmentIdAtom);
  return search.environmentId ?? destination ?? primary;
}

export function DuetProjectPicker({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useDuetActions(environmentId);
  const projects = useProjects().filter(
    (p) => p.environmentId === environmentId && p.archivedAt === null,
  );
  return (
    <label className="grid gap-2 text-sm">
      Project
      <select
        aria-label="Duet project"
        className="rounded-md border bg-background p-2"
        disabled={!actions.canWrite}
        value={actions.settings.duetProjectId ?? ""}
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

export function DuetPage() {
  const environmentId = useDuetEnvironmentId();
  return environmentId ? (
    <DuetWorkspace environmentId={environmentId} />
  ) : (
    <SidebarInset>
      <p className="p-6">Connect to an environment to use Duet.</p>
    </SidebarInset>
  );
}

function DuetWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const { settings, project } = useDuetActions(environmentId);
  const search = useSearch({ from: "/_chat/duet" });
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
    void navigate({ to: "/duet", search: { environmentId, threadId, tab: "chat" } });
  if (!settings.duetEnabled)
    return (
      <SidebarInset>
        <div className="p-6">
          Enable Duet in{" "}
          <Link to="/settings/general" hash="duet-enabled">
            Settings → Duet
          </Link>
          .
        </div>
      </SidebarInset>
    );
  if (!project)
    return (
      <SidebarInset>
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
          <h1 className="text-xl font-semibold">Duet</h1>
          <p>Choose the project Duet focuses on.</p>
          <DuetProjectPicker environmentId={environmentId} />
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
        {isElectron && window.desktopBridge?.setDuetWindowMode ? (
          <div className="[-webkit-app-region:no-drag]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const bridge = window.desktopBridge;
                if (bridge)
                  void bridge
                    .setDuetWindowMode?.({
                      mode: bridge.isDuetWindow?.() ? "merged" : "split",
                      environmentId,
                      ...(selected ? { threadId: selected.id } : {}),
                      tab: search.tab ?? "chat",
                    })
                    .catch(() => toastManager.add({ type: "error", title: "Could not move Duet" }));
              }}
            >
              {window.desktopBridge.isDuetWindow?.() ? "Merge" : "Split"}
            </Button>
          </div>
        ) : null}
        <div role="tablist" aria-label="Duet" className="flex gap-1 [-webkit-app-region:no-drag]">
          {(["chat", "tasks"] as const).map((tab) => (
            <Button
              key={tab}
              role="tab"
              aria-selected={(search.tab ?? "chat") === tab}
              variant={(search.tab ?? "chat") === tab ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void navigate({ to: "/duet", search: { ...search, tab } })}
            >
              {tab === "chat" ? "Chat" : "Tasks"}
            </Button>
          ))}
        </div>
      </header>
      {search.tab === "tasks" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <h1 className="mb-3 text-lg font-semibold">Tasks</h1>
          {orderDuetTasks(threads).map((thread) => (
            <button
              key={thread.id}
              className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted"
              onClick={() => open(thread.id)}
            >
              <DuetIcon
                icon={settings.duetThreads[thread.id]?.icon ?? null}
                color={duetIconColor(thread.id, settings.duetThreads[thread.id]?.color)}
              />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="text-xs text-muted-foreground">{duetTaskLabel(thread)}</span>
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

export function DuetSidebar() {
  const environmentId = useDuetEnvironmentId();
  return environmentId ? <DuetThreadList environmentId={environmentId} /> : null;
}

function DuetThreadList({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useDuetActions(environmentId);
  const search = useSearch({ from: "/_chat/duet" });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const threads = useVisibleThreadShells()
    .filter(
      (t) =>
        t.environmentId === environmentId &&
        t.projectId === actions.project?.id &&
        t.deletedAt === null &&
        t.archivedAt === null,
    )
    .toSorted(
      (a, b) =>
        Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const open = (threadId: ThreadId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/duet", search: { environmentId, threadId, tab: "chat" } });
  };
  const edited = threads.find((t) => t.id === editing);
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <Link to="/duet" search={{ environmentId }}>
            ✦ Duet
          </Link>
          <Link to="/settings/general" hash="duet-enabled">
            Settings
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {actions.settings.duetEnabled ? (
          <div className="space-y-1 p-2">
            <Button
              variant="outline"
              size="sm"
              disabled={
                busy ||
                !actions.project ||
                !actions.modelSelection ||
                !actions.canWrite ||
                !canOperate
              }
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                await (async () => {
                  const id = await actions.createThread();
                  if (id) open(id);
                })().finally(() => {
                  pending.current = false;
                  setBusy(false);
                });
              }}
            >
              New thread
            </Button>
            {threads.map((thread) => (
              <div key={thread.id} className="flex items-center rounded-md hover:bg-muted">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left text-sm"
                  aria-current={search.threadId === thread.id ? "page" : undefined}
                  onClick={() => open(thread.id)}
                >
                  <DuetIcon
                    icon={actions.settings.duetThreads[thread.id]?.icon ?? null}
                    color={duetIconColor(thread.id, actions.settings.duetThreads[thread.id]?.color)}
                  />
                  <span className="truncate">{thread.title}</span>
                  {thread.pinnedAt === null ? (
                    <span className="ml-auto text-xs text-muted-foreground">Temporary</span>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${thread.title}`}
                  disabled={!canOperate || !actions.canWrite}
                  onClick={() => setEditing(thread.id)}
                >
                  ✎
                </Button>
              </div>
            ))}
            {!actions.modelSelection ? (
              <p className="p-2 text-xs text-muted-foreground">
                Set up an agent in Settings to create threads.
              </p>
            ) : null}
          </div>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <Link to="/">Open T3 Code</Link>
      </SidebarFooter>
      {edited ? (
        <DuetThreadEditor
          key={edited.id}
          environmentId={environmentId}
          thread={edited}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function DuetThreadEditor({
  environmentId,
  thread,
  onClose,
}: {
  environmentId: EnvironmentId;
  thread: ReturnType<typeof useVisibleThreadShells>[number];
  onClose: () => void;
}) {
  const actions = useDuetActions(environmentId);
  const entry = actions.settings.duetThreads[thread.id];
  const [title, setTitle] = useState(thread.title);
  const [icon, setIcon] = useState(entry?.icon ?? "");
  const [color, setColor] = useState(duetIconColor(thread.id, entry?.color));
  const [prompt, setPrompt] = useState(entry?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(thread.pinnedAt !== null);
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const pin = useAtomCommand(threadEnvironment.pin);
  const unpin = useAtomCommand(threadEnvironment.unpin);
  const save = async () => {
    setBusy(true);
    await (async () => {
      if (
        (await update({ environmentId, input: { threadId: thread.id, title: title.trim() } }))
          ._tag !== "Success"
      )
        return;
      if (!(await actions.setThreadSettings(thread.id, icon.trim() || null, prompt, color || null)))
        return;
      if (
        pinned !== (thread.pinnedAt !== null) &&
        (await (pinned ? pin : unpin)({ environmentId, input: { threadId: thread.id } }))._tag !==
          "Success"
      )
        return;
      onClose();
    })().finally(() => {
      setBusy(false);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Edit Duet thread</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              Title
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
            </label>
            <DuetIconPicker
              icon={icon}
              color={color}
              onIconChange={setIcon}
              onColorChange={setColor}
            />
            <label className="grid gap-1 text-sm">
              Thread prompt
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={DUET_THREAD_PROMPT_MAX_LENGTH}
              />
              <span className="text-xs text-muted-foreground">
                Included privately with the title on every turn.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Keep this thread pinned
            </label>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
