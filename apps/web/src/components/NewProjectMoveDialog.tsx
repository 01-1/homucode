import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";

type Request = { readonly resolve: (name: string | null) => void };
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestNewProjectMove(): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { resolve } }));
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function NewProjectMoveDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolve a pending menu request when its dialog host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <NewProjectMoveDialog /> : null;
}

function NewProjectMoveDialog() {
  const id = useId();
  const [name, setName] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) finish(name.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Move to a new project</DialogTitle>
            <DialogDescription>
              The thread and its children keep their current working folders.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label htmlFor={id}>Project name</Label>
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create and move
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
