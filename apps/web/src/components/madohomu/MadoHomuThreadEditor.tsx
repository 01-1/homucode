import { isMadoHomuThreadPinned, madohomuIconColor } from "@t3tools/client-runtime/madohomu";
import { MADOHOMU_THREAD_PROMPT_MAX_LENGTH, type EnvironmentId } from "@t3tools/contracts";
import type { SidebarThreadSummary } from "../../types";
import { useState } from "react";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { MadoHomuIconPicker } from "./MadoHomuIcon";
import { useMadoHomuActions } from "./useMadoHomuActions";

export function MadoHomuThreadEditor({
  environmentId,
  thread,
  onClose,
}: {
  environmentId: EnvironmentId;
  thread: Pick<SidebarThreadSummary, "id" | "title">;
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
