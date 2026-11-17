import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { Link, useSearch } from "@tanstack/react-router";
import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { CombineIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useVisibleThreadShells } from "../../state/entities";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuEnvironmentId } from "./useMadoHomuEnvironmentId";
import { MadoHomuNoProject } from "./MadoHomuProjectPicker";

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
        <MadoHomuNoProject environmentId={environmentId} />
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
