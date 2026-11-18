import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { useEnvironmentScope } from "../../state/session";
import { ThreadHeader } from "../threads/ThreadHeader";
import type { MadoHomuEditableThread } from "./MadoHomuThreadEditor";
import { useMadoHomuFiling } from "./useMadoHomuActions";
import { useMadoHomuThreadMenu } from "./useMadoHomuThreadMenu";

/** The thread header of a thread opened from MadoHomu, with its Move to and Edit… menu. */
export function MadoHomuThreadHeader(
  props: ComponentProps<typeof ThreadHeader> & {
    readonly environmentId: EnvironmentId;
    readonly thread: MadoHomuEditableThread;
  },
) {
  const { environmentId, thread, ...header } = props;
  const actions = useMadoHomuFiling(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threadMenu = useMadoHomuThreadMenu({
    environmentId,
    actions,
    thread,
    canEdit: actions.canWrite && canOperate,
  });
  return (
    <>
      <ThreadHeader
        {...header}
        extraMenus={actions.settings.madohomuEnabled ? [threadMenu.headerMenu(thread.id)] : []}
      />
      {threadMenu.editor}
    </>
  );
}
