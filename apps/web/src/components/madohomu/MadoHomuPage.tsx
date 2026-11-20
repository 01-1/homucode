import { useGT, T } from "gt-react";
import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { Link, useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { type ReactNode, useEffect } from "react";
import { SquareArrowDownLeftIcon, SquareArrowOutUpRightIcon, SquarePenIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { forgetCreatedMadoHomuThread } from "../../madohomu";
import { useEnvironment } from "../../state/environments";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuEnvironmentId } from "./useMadoHomuEnvironmentId";
import { MadoHomuNoProject } from "./MadoHomuProjectPicker";
import { useMadoHomuThreadMenu } from "./useMadoHomuThreadMenu";
import {
  useMadoHomuNewThread,
  useMadoHomuSelection,
  useMadoHomuThreads,
} from "./useMadoHomuThreads";

export function MadoHomuPage() {
  const gt = useGT();
  const environmentId = useMadoHomuEnvironmentId();
  return environmentId ? (
    <MadoHomuWorkspace key={environmentId} environmentId={environmentId} />
  ) : (
    <SidebarInset>
      <MadoHomuTitlebar />
      <MadoHomuNoProject
        environmentId={null}
        message={gt("Connect to an environment to use MadoHomu.")}
      />
    </SidebarInset>
  );
}

function MadoHomuWindowModeButton({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId?: ThreadId | undefined;
}) {
  const gt = useGT();
  const bridge = isElectron ? window.desktopBridge : undefined;
  if (!bridge?.setMadoHomuWindowMode) return null;
  const split = bridge.isMadoHomuWindow?.() === true;
  const label = split ? "Merge MadoHomu into the main window" : "Open MadoHomu in its own window";
  // One pop-out arrow, pointing out to split and back in to merge.
  const Icon = split ? SquareArrowDownLeftIcon : SquareArrowOutUpRightIcon;
  const toggle = () =>
    void bridge
      .setMadoHomuWindowMode?.({
        mode: split ? "merged" : "split",
        environmentId,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => toastManager.add({ type: "error", title: gt("Could not move MadoHomu") }));
  return (
    <>
      <Button
        aria-label={label}
        className="hidden shrink-0 [-webkit-app-region:no-drag] min-[700px]:inline-flex"
        size="sm"
        variant="ghost"
        onClick={toggle}
      >
        <Icon className="size-3.5" />
        {split
          ? gt("Merge", { $context: "verb, return MadoHomu to the main window" })
          : gt("Split", { $context: "verb, move MadoHomu into its own window" })}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="shrink-0 [-webkit-app-region:no-drag] min-[700px]:hidden"
              size="icon-sm"
              variant="ghost"
              onClick={toggle}
            />
          }
        >
          <Icon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
    </>
  );
}

function MadoHomuWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const environment = useEnvironment(environmentId);
  const { settings, project } = useMadoHomuThreads(environmentId);
  const selection = useMadoHomuSelection(environmentId);
  const selectedId = selection.threadId;
  const threadMenu = useMadoHomuThreadMenu(environmentId);
  const navigate = useNavigate();
  const { namedId, namedLoaded, replace } = selection;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the fallback thread into the URL once the named one is known to be gone, and drops the just-made mark once its shell arrives.
  useEffect(() => {
    if (namedId && namedLoaded) forgetCreatedMadoHomuThread(scopeThreadRef(environmentId, namedId));
    if (!replace || selectedId === null || namedId === selectedId) return;
    void navigate({
      to: "/madohomu",
      search: { environmentId, threadId: selectedId },
      replace: true,
    });
  }, [environmentId, namedId, namedLoaded, navigate, replace, selectedId]);
  const windowMode = <MadoHomuWindowModeButton environmentId={environmentId} />;
  if (!settings.madohomuEnabled || !project)
    return (
      <SidebarInset>
        <MadoHomuTitlebar trailing={windowMode} />
        <MadoHomuNoProject
          environmentId={environmentId}
          {...(environment?.connection.phase !== "connected"
            ? {
                message: gt("Reconnect {machine}, or choose a project on another machine.", {
                  machine: environment?.label ?? gt("the selected machine"),
                }),
              }
            : !settings.madohomuEnabled
              ? { message: gt("Choose a project to enable MadoHomu on its machine.") }
              : {})}
        />
      </SidebarInset>
    );
  if (selection.loading)
    return (
      <SidebarInset>
        <MadoHomuTitlebar trailing={windowMode} />
        <p className="p-6 text-sm text-muted-foreground" role="status">
          <T>Loading…</T>
        </p>
      </SidebarInset>
    );
  if (!selectedId)
    return (
      <SidebarInset>
        <MadoHomuTitlebar trailing={windowMode} />
        <MadoHomuNoThreads environmentId={environmentId} />
      </SidebarInset>
    );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <ChatView
        environmentId={environmentId}
        threadId={selectedId}
        routeKind="server"
        focusedHeader={{
          trailing: (
            <MadoHomuWindowModeButton environmentId={environmentId} threadId={selectedId} />
          ),
          menuExtras: threadMenu.menuExtras(selectedId),
        }}
      />
      {threadMenu.editor}
    </SidebarInset>
  );
}

function MadoHomuNoThreads({ environmentId }: { environmentId: EnvironmentId }) {
  const actions = useMadoHomuActions(environmentId);
  const { createThread, creating } = useMadoHomuNewThread(environmentId);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        <T>No threads yet.</T>
      </p>
      <Button
        disabled={creating || !actions.modelSelection || !actions.canWrite}
        onClick={() => void createThread()}
      >
        <SquarePenIcon aria-hidden />
        <T>New thread</T>
      </Button>
      {!actions.modelSelection ? (
        <>
          <p className="text-xs text-muted-foreground">
            <T>No agent is set up yet, so MadoHomu cannot start a thread.</T>
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/settings/providers" search={{ environmentId }} />}
          >
            <T>Open provider settings</T>
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** A title bar without a thread: room for the floating sidebar toggle and a strip that moves the window. */
function MadoHomuTitlebar({ trailing }: { trailing?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-[var(--workspace-topbar-height)] shrink-0 items-center justify-end px-3",
        isElectron && "drag-region wco:pr-(--workspace-native-controls-inset)",
      )}
    >
      {trailing}
    </div>
  );
}
