import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { useEnvironmentScope } from "../../state/session";
import { ThreadHeader } from "../threads/ThreadHeader";
import { useMadoHomuActions } from "./useMadoHomuActions";
import { useMadoHomuThreadMenu } from "./useMadoHomuThreadMenu";

/** The thread header of a thread opened from MadoHomu, with its Move to and Edit… menu. */
export function MadoHomuThreadHeader(
  props: ComponentProps<typeof ThreadHeader> & {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  },
) {
  const { environmentId, threadId, ...header } = props;
  const actions = useMadoHomuActions(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threadMenu = useMadoHomuThreadMenu({
    environmentId,
    actions,
    canEdit: actions.canWrite && canOperate,
  });
  return (
    <>
      <ThreadHeader
        {...header}
        extraMenus={actions.settings.madohomuEnabled ? [threadMenu.headerMenu(threadId)] : []}
      />
      {threadMenu.editor}
    </>
  );
}
