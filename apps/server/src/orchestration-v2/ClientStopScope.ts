import type { OrchestrationV2Command } from "@t3tools/contracts";

/**
 * A Stop sent by an app ends only that thread: its subagents keep running and still report back.
 * Apps that want the old cascade say so with `stopDelegatedTasks: true`. Applied at the client
 * socket, so phones and other clients that predate the flag get the same behavior; the server's
 * own Stops (tree walks, MCP tools) never pass through here.
 */
export function withClientStopScope(command: OrchestrationV2Command): OrchestrationV2Command {
  // `/stopall` sent as a message, from any app, stops the thread and its subagents.
  if (
    command.type === "message.dispatch" &&
    command.attachments.length === 0 &&
    command.text.trim().toLowerCase() === "/stopall"
  ) {
    return {
      type: "thread.stop",
      commandId: command.commandId,
      threadId: command.threadId,
      stopDelegatedTasks: true,
    };
  }
  if (
    command.type === "thread.stop" &&
    command.stopDelegatedTasks === undefined &&
    command.leaveSubagentsRunning === undefined
  ) {
    return { ...command, leaveSubagentsRunning: true };
  }
  if (
    command.type === "run.interrupt" &&
    command.holdQueue === true &&
    command.leaveSubagentsRunning === undefined
  ) {
    return { ...command, leaveSubagentsRunning: true };
  }
  return command;
}
