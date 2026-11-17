import { useAtomValue } from "@effect/atom-react";
import { madohomuDestinationEnvironmentIdAtom } from "../../madohomu";
import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { MadoHomuIcon, MadoHomuIconPicker } from "./MadoHomuIcon";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  madohomuIconColor,
  isMadoHomuThreadPinned,
  orderMadoHomuThreads,
} from "@t3tools/client-runtime/madohomu";
import {
  AuthOrchestrationOperateScope,
  MADOHOMU_THREAD_PROMPT_MAX_LENGTH,
  ProjectId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useRef, useState, type ReactNode } from "react";
import { CombineIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
    <MadoHomuMessage>Connect to an environment to use MadoHomu.</MadoHomuMessage>
  );
}

function MadoHomuWindowModeButton({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const bridge = isElectron ? window.desktopBridge : undefined;
  if (!bridge?.setMadoHomuWindowMode) return null;
  const split = bridge.isMadoHomuWindow?.() === true;
  const label = split ? "Merge MadoHomu into the main window" : "Open MadoHomu in its own window";
  const Icon = split ? CombineIcon : SquareArrowOutUpRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="shrink-0 [-webkit-app-region:no-drag]"
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              void bridge
                .setMadoHomuWindowMode?.({
                  mode: split ? "merged" : "split",
                  environmentId,
                  threadId,
                })
                .catch(() => toastManager.add({ type: "error", title: "Could not move MadoHomu" }))
            }
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function MadoHomuWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const { settings, project } = useMadoHomuActions(environmentId);
  const search = useSearch({ from: "/_chat/madohomu" });
  const threads = useVisibleThreadShells().filter(
    (t) =>
      t.environmentId === environmentId &&
      t.projectId === project?.id &&
      t.deletedAt === null &&
      t.archivedAt === null,
  );
  const selected = threads.find((t) => t.id === search.threadId) ?? threads[0];
  if (!settings.madohomuEnabled)
    return (
      <MadoHomuMessage>
        Enable MadoHomu in{" "}
        <Link to="/settings/general" hash="madohomu-enabled">
          Settings → MadoHomu
        </Link>
        .
      </MadoHomuMessage>
    );
  if (!project)
    return (
      <SidebarInset>
        <MadoHomuTitlebar />
        <div className="mx-auto w-full max-w-md space-y-4 p-6">
          <h1 className="text-xl font-semibold">MadoHomu</h1>
          <p>Choose the project MadoHomu focuses on.</p>
          <MadoHomuProjectPicker environmentId={environmentId} />
        </div>
      </SidebarInset>
    );
  if (!selected)
    return (
      <MadoHomuMessage>Make a thread with New thread in the sidebar to start.</MadoHomuMessage>
    );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <ChatView
        environmentId={environmentId}
        threadId={selected.id}
        routeKind="server"
        focusedHeader={{
          trailing: (
            <MadoHomuWindowModeButton environmentId={environmentId} threadId={selected.id} />
          ),
        }}
      />
    </SidebarInset>
  );
}

/** An empty title bar: room for the floating sidebar toggle and a strip that moves the window. */
function MadoHomuTitlebar() {
  return (
    <div
      aria-hidden
      className={cn("h-[var(--workspace-topbar-height)] shrink-0", isElectron && "drag-region")}
    />
  );
}

function MadoHomuMessage({ children }: { children: ReactNode }) {
  return (
    <SidebarInset>
      <MadoHomuTitlebar />
      <p className="p-6 text-sm text-muted-foreground">{children}</p>
    </SidebarInset>
  );
}

export function MadoHomuSidebar() {
  const environmentId = useMadoHomuEnvironmentId();
  return environmentId ? <MadoHomuThreadList environmentId={environmentId} /> : null;
}

function MadoHomuThreadList({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const search = useSearch({ from: "/_chat/madohomu" });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const threads = orderMadoHomuThreads(
    useVisibleThreadShells().filter(
      (t) =>
        t.environmentId === environmentId &&
        t.projectId === actions.project?.id &&
        t.deletedAt === null &&
        t.archivedAt === null,
    ),
    actions.settings.madohomuThreads,
  );
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [editing, setEditing] = useState<ThreadId | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const open = (threadId: ThreadId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/madohomu", search: { environmentId, threadId } });
  };
  const edited = threads.find((t) => t.id === editing);
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <Link to="/madohomu" search={{ environmentId }}>
            ✦ MadoHomu
          </Link>
          <Link to="/settings/general" hash="madohomu-enabled">
            Settings
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {actions.settings.madohomuEnabled ? (
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
                  <MadoHomuIcon
                    icon={actions.settings.madohomuThreads[thread.id]?.icon ?? null}
                    color={madohomuIconColor(
                      thread.id,
                      actions.settings.madohomuThreads[thread.id]?.color,
                    )}
                  />
                  <span className="truncate">{thread.title}</span>
                  {!isMadoHomuThreadPinned(actions.settings.madohomuThreads[thread.id]) ? (
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
        <MadoHomuThreadEditor
          key={edited.id}
          environmentId={environmentId}
          thread={edited}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function MadoHomuThreadEditor({
  environmentId,
  thread,
  onClose,
}: {
  environmentId: EnvironmentId;
  thread: ReturnType<typeof useVisibleThreadShells>[number];
  onClose: () => void;
}) {
  const actions = useMadoHomuActions(environmentId);
  const entry = actions.settings.madohomuThreads[thread.id];
  const [title, setTitle] = useState(thread.title);
  const [icon, setIcon] = useState(entry?.icon ?? "");
  const [color, setColor] = useState(madohomuIconColor(thread.id, entry?.color));
  const [prompt, setPrompt] = useState(entry?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(isMadoHomuThreadPinned(entry));
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const save = async () => {
    setBusy(true);
    await (async () => {
      if (
        (await update({ environmentId, input: { threadId: thread.id, title: title.trim() } }))
          ._tag !== "Success"
      )
        return;
      if (
        !(await actions.setThreadSettings(
          thread.id,
          icon.trim() || null,
          prompt,
          color || null,
          pinned,
        ))
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
          <DialogTitle>Edit MadoHomu thread</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              Title
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
            </label>
            <MadoHomuIconPicker
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
                maxLength={MADOHOMU_THREAD_PROMPT_MAX_LENGTH}
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
