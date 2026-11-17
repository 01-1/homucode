#!/usr/bin/env python3
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import subprocess as sp
import sys
import tarfile
import tempfile
import time

HERE = Path(__file__).resolve().parent
BOAT = ["boat", "--no-update", "--json"]
REMOTE = "/home/user/homucode-checks"
PROJECTS = {
    "origin": "https://github.com/homura-ai/homucode.git",
    "upstream": "https://github.com/pingdotgg/t3code.git",
}
ACTIVE_TTL = 7200
STATE = Path.home() / ".local/state/homucode-checks"


class BoatUnavailable(Exception):
    pass


def log(message):
    print(f"homucode boat: {message}", file=sys.stderr, flush=True)


def git(*args):
    return sp.check_output(["git", *args])


def frames(*args, timeout=45):
    try:
        result = sp.run([*BOAT, *args], capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise BoatUnavailable((result.stdout + result.stderr).strip())
        events = [json.loads(line) for line in result.stdout.splitlines()]
        if any(not isinstance(event, dict) for event in events):
            raise ValueError("Boat returned a non-object response")
        return events
    except (OSError, sp.TimeoutExpired, ValueError) as error:
        raise BoatUnavailable(str(error)) from error


@contextlib.contextmanager
def lease(state):
    # One warm slot and one overflow slot across all pbox worktrees.
    with (state / "warm.lock").open("a") as warm, (state / "extra.lock").open("a") as extra:
        waiting = False
        while True:
            for slot, lock in [("warm", warm), ("extra", extra)]:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                yield slot
                return
            if not waiting:
                log("both boxes are busy; waiting for a slot")
                waiting = True
            time.sleep(0.5)


@contextlib.contextmanager
def sandbox(slot):
    name = f"homucode-checks-{socket.gethostname().split('.')[0]}"
    if slot == "extra":
        name += "-extra"
    events = frames("list", "--all")
    boxes = events[0].get("sandboxes") if events else None
    if not isinstance(boxes, list) or any(
        not isinstance(box, dict)
        or any(not isinstance(box.get(key), str) for key in ("id", "name", "state"))
        for box in boxes
    ):
        raise BoatUnavailable("Boat returned an incomplete sandbox list")
    previous = next((box for box in boxes if box["name"] == name), None)
    box = None
    try:
        if previous and slot == "extra":
            frames("delete", previous["id"], "--yes")
        elif previous and not previous.get("dataExpiredAt"):
            if previous["state"] == "stopped":
                frames("resume", previous["id"], timeout=300)
                log(f"resumed {previous['id']}")
            elif previous["state"] not in ("idle", "ready", "running"):
                raise BoatUnavailable(f"{previous['id']} is {previous['state']}")
            else:
                log(f"reusing {previous['id']}")
            box = previous["id"]
            frames("extend", box, "--ttl", str(ACTIVE_TTL))
        if not box:
            flags = ["--no-snapshots"] if slot == "extra" else []
            log(f"starting a large {slot} box")
            events = frames(
                "new", "--personal", "--no-env", "--type", "large", "--name", name,
                "--ttl", str(ACTIVE_TTL), *flags, timeout=300,
            )
            created = next((event.get("id") for event in events if event.get("event") == "created"), None)
            if not isinstance(created, str) or not re.fullmatch(r"bx_[a-z0-9]+", created):
                raise BoatUnavailable("Boat returned no valid sandbox ID")
            box = created
        yield box
    finally:
        if box:
            try:
                if slot == "extra":
                    frames("delete", box, "--yes")
                else:
                    idle = os.environ.get("HOMU_BOAT_IDLE_SECONDS", "900")
                    frames("extend", box, "--ttl", idle)
                    log(f"{box} will stop after {idle}s idle")
            except BoatUnavailable as error:
                log(f"could not set idle expiry or delete {box}: {error}")


def ssh(box, script, **kwargs):
    return sp.run([*BOAT, "ssh", box, "--", script], **kwargs)


def stream(box, *args):
    status = None
    pid = None
    with sp.Popen(
        [*BOAT, "exec", box, "--stream", "--timeout", "5400", "--", *args],
        stdout=sp.PIPE, text=True, encoding="utf-8", errors="replace",
    ) as proc:
        try:
            for line in proc.stdout:
                event = json.loads(line)
                if not isinstance(event, dict):
                    raise ValueError("expected a JSON object")
                kind = event.get("type")
                match kind:
                    case "attached":
                        attached = event.get("processId")
                        if type(attached) is not int or attached <= 0:
                            raise ValueError("invalid process ID")
                        pid = attached
                    case "stdout" | "stderr":
                        if not isinstance(event.get("data"), str):
                            raise ValueError(f"missing {kind} data")
                        target = sys.stdout if kind == "stdout" else sys.stderr
                        print(event["data"], end="", file=target, flush=True)
                    case "exit":
                        code = event.get("exitCode")
                        received_signal = event.get("signal")
                        signaled = (
                            isinstance(received_signal, str)
                            and received_signal in signal.Signals.__members__
                        ) or (type(received_signal) is int and received_signal in signal.valid_signals())
                        if not (type(code) is int and 0 <= code <= 255 or code is None and signaled):
                            raise ValueError("invalid exit code or signal")
                        status = event
                    case _:
                        if "error" in event:
                            log(event["error"])
        except KeyboardInterrupt:
            proc.terminate()
            cancel_remote(box, pid)
            raise
        except ValueError as error:
            status = None
            proc.terminate()
            log(f"invalid Boat stream frame: {error}")
    if status is None:
        cancel_remote(box, pid)
        raise BoatUnavailable(f"lost the result from {box}; see the Boat output above")
    code = status.get("exitCode")
    return code if code is not None else (proc.returncode or 1)


def cancel_remote(box, pid):
    if pid is None:
        return
    try:
        frames("exec", box, "--kill", str(pid), timeout=10)
    except BoatUnavailable as error:
        log(f"could not cancel process {pid} on {box}: {error}")


def transfer(box, operation):
    try:
        return operation()
    except (sp.TimeoutExpired, sp.CalledProcessError) as error:
        raise BoatUnavailable(f"transfer to {box} failed: {error}") from error


def sync(box, root, args, scratch):
    remote_source = f"{REMOTE}/source"
    if transfer(box, lambda: ssh(box, "true", timeout=40)).returncode:
        raise BoatUnavailable(f"could not connect to {box} over SSH")

    subprocess_args = []
    refs = ["+HEAD:refs/heads/boat-check"]
    for name, url in PROJECTS.items():
        ref = f"refs/remotes/{name}/main"
        if sp.run(["git", "show-ref", "--verify", "--quiet", ref]).returncode == 0:
            refs.append(f"+{ref}:{ref}")
            subprocess_args.extend([name, url])

    if args[:2] == ["run", "check:changed"]:
        # The checker accepts one positional ref in addition to these two flags.
        index = 2
        while index < len(args):
            arg = args[index]
            if arg in ("--concurrency", "--timeout"):
                index += 2
                continue
            if not arg.startswith("-"):
                commit = git("rev-parse", "--verify", "--end-of-options", f"{arg}^{{commit}}").decode().strip()
                refs.append(f"+{commit}:refs/boat/compare")
                args[index] = commit
                break
            index += 1

    bundle = scratch / "request.tar"
    with tarfile.open(bundle, "w") as archive:
        for name, options in [
            ("staged.patch", ["--cached", "HEAD"]),
            ("unstaged.patch", []),
        ]:
            patch = scratch / name
            patch.write_bytes(git("diff", "--binary", "--no-ext-diff", "--no-textconv", *options, "--"))
            archive.add(patch, arcname=name)
        paths = set(
            git("diff", "--name-only", "-z", "--no-renames", "HEAD", "--").split(b"\0")
            + git("ls-files", "-z", "--others", "--exclude-standard").split(b"\0")
        )
        for name in sorted(paths - {b""}):
            relative = os.fsdecode(name)
            path = root / relative
            if path.is_symlink() or path.is_file():
                archive.add(path, arcname=f"tree/{relative}", recursive=False)
        archive.add(HERE / "remote.sh", arcname="run.sh")

    # Git negotiates with objects already on the box. Prime cold boxes from public main.
    cleanup = (
        f"mkdir -p {REMOTE} && flock -w 300 {REMOTE}/worktree.lock bash -c "
        + shlex.quote(f"rm -rf {REMOTE}/request && mkdir {REMOTE}/request && tar -xf - -C {REMOTE}/request")
    )
    with bundle.open("rb") as archive:
        transfer(box, lambda: ssh(box, cleanup, stdin=archive, check=True, timeout=300))
    code = stream(box, "bash", f"{REMOTE}/request/run.sh", "init", *subprocess_args)
    if code:
        return code
    transfer(box, lambda: sp.run(
        ["nice", "-n", "19", "ionice", "-c", "3", "git", "-c", "pack.threads=1",
         "push", "--no-verify", f"ssh://{box}{remote_source}/.git", *refs],
        env={**os.environ, "GIT_SSH_COMMAND": shlex.join([str(HERE / "cloud.py"), "ssh"]),
             "GIT_SSH_VARIANT": "simple"},
        check=True, timeout=300,
    ))
    return 0


def run_remote(root, args, output=None):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lease(STATE) as slot, sandbox(slot) as box, tempfile.TemporaryDirectory() as temp:
        log(f"running on {box}")
        cwd = str(Path.cwd().relative_to(root))
        os.chdir(root)
        try:
            code = sync(box, root, args, Path(temp))
        finally:
            os.chdir(root / cwd)
        if code:
            return code
        forwarded = [
            f"{name}={os.environ[name]}"
            for name in ("CHECK_CHANGED_CONCURRENCY", "CHECK_CHANGED_TIMEOUT", "CI", "FORCE_COLOR")
            if name in os.environ
        ]
        # Vite+ staged passes absolute paths to its linters.
        prefix = str(root) + "/"
        remote_args = [
            f"{REMOTE}/source/{arg.removeprefix(prefix)}" if arg.startswith(prefix) else arg
            for arg in args
        ]
        code = stream(box, "env", *forwarded, "bash", f"{REMOTE}/request/run.sh", cwd, *remote_args)
        if code == 0 and output:
            _, abi, fingerprint = args
            artifact = f"/home/user/.cache/t3code/native-clients/artifacts/android/development-{abi}/{fingerprint}/app-debug.apk"
            sp.run([*BOAT, "scp", f"{box}:{artifact}", output], check=True, timeout=300)
        return code


def real_vp(root):
    candidates = [
        *(([root / "node_modules/.bin/vp"]) if root else []),
        *[Path(entry) / "vp" for entry in os.get_exec_path()],
        Path.home() / ".vite-plus/bin/vp",
        HERE / "vite-plus/node_modules/.bin/vp",
    ]
    for candidate in candidates:
        if candidate.resolve() != HERE / "vp" and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError("Vite+ is missing. Install Vite+ or run scripts/homu-boat/install.sh.")


def offload(args):
    if not args:
        return False
    if args[0] in ("test", "check", "lint"):
        return True
    if args[0] == "exec":
        return args[1:2] in (["knip"], ["vitest"])
    if args[0] != "run":
        return False
    return any(
        arg in ("check:changed", "typecheck", "tc", "lint", "test")
        or arg.startswith(("knip", "lint:", "test:"))
        for arg in args[1:]
    )


def local_check(root, args):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ.pop("HOMU_VP_SHIM", None)
    os.environ["HOMU_BOAT_FALLBACK"] = "1"
    command = [
        "flock", "--close", str(STATE / "fallback.lock"), "nice", "-n", "19",
        "ionice", "-c", "3", real_vp(root), *args,
    ]
    os.execvp(command[0], command)


def vp():
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    args = sys.argv[1:]
    try:
        root = Path(sp.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True, stderr=sp.DEVNULL
        ).strip())
    except sp.CalledProcessError:
        root = None
    homucode = root and (root / "scripts/homu-android/build.sh").is_file()
    pbox = socket.gethostname().split(".")[0] == "pbox"
    try:
        if pbox and homucode and os.environ.get("HOMU_BOAT_FALLBACK") != "1":
            if offload(args):
                if any(arg == "--fix" or arg.startswith("--fix-") for arg in args) and (
                    args[0] in ("lint", "check") or "lint" in args[1:]
                ):
                    log("running fixes locally under the pbox check lock")
                    local_check(root, args)
                try:
                    return run_remote(root, args.copy())
                except BoatUnavailable as error:
                    if os.environ.get("HOMU_BOAT_NO_FALLBACK") == "1":
                        raise
                    log(f"Boat unavailable ({error}); waiting for the pbox check lock")
                    local_check(root, args)
            if args[:1] == ["staged"]:
                os.environ["HOMU_VP_SHIM"] = str(HERE / "vp")
            if "mobile:install" in args[1:] and "android" in args[1:] and not (
                root / "scripts/homu-boat/cloud.py"
            ).exists():
                raise RuntimeError("Update this worktree for Android installs on Boat.")
        command = real_vp(root)
        os.execv(command, [command, *args])
    except KeyboardInterrupt:
        return 130
    except (BoatUnavailable, OSError, RuntimeError, ValueError, sp.SubprocessError) as error:
        log(str(error))
        return 1


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "ssh":
        host, command = args
        os.execvp(BOAT[0], [*BOAT, "ssh", host, "--", command])
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    try:
        abi, fingerprint, output = args
        if mode != "android" or abi not in ("arm64-v8a", "x86_64") or not re.fullmatch(r"[a-f0-9]{40,64}", fingerprint):
            raise RuntimeError("Expected android ABI FINGERPRINT OUTPUT.")
        root = Path(git("rev-parse", "--show-toplevel").decode().strip())
        raise SystemExit(run_remote(root, [mode, abi, fingerprint], output))
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (BoatUnavailable, OSError, RuntimeError, ValueError, sp.SubprocessError) as error:
        log(str(error))
        raise SystemExit(1)
