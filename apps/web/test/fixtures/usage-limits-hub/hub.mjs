// Fake CLIProxyAPI management API serving the Limits scenarios in scenarios.json.
// Usage: node hub.mjs <state.json> [port]. state.json is {"scenario": "A", "n0": <epoch ms>};
// it is re-read on every request, so edit it and press Refresh limits to switch scenarios.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";

const [statePath, port = "18517"] = process.argv.slice(2);
if (!statePath) throw new Error("usage: node hub.mjs <state.json> [port]");
const scenarios = JSON.parse(
  NodeFS.readFileSync(new URL("./scenarios.json", import.meta.url), "utf8"),
);
const MINUTE = 60_000;

// A window is [usedPercent, minutesFromN0 | null]; null is unknown reset timing.
const at = (n0, minutes) => (minutes === null ? null : n0 + minutes * MINUTE);
const iso = (n0, minutes) =>
  minutes === null ? undefined : new Date(at(n0, minutes)).toISOString();
const usage = (account, n0) => {
  const [session, weekly] = account.windows;
  if (account.provider === "xai") {
    return {
      config: {
        creditUsagePercent: session[0],
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: iso(n0, session[1]) },
      },
    };
  }
  if (account.provider === "antigravity") {
    const bucket = (bucketId, window, [used, minutes]) => ({
      bucketId,
      window,
      remainingFraction: 1 - used / 100,
      resetTime: iso(n0, minutes),
    });
    return {
      buckets: [bucket("gemini-5h", "5h", session), bucket("gemini-weekly", "weekly", weekly)],
    };
  }
  if (account.provider === "codex") {
    const window = ([used, minutes], seconds) => ({
      used_percent: used,
      reset_at: at(n0, minutes) === null ? null : Math.floor(at(n0, minutes) / 1000),
      limit_window_seconds: seconds,
    });
    return {
      plan_type: "pro",
      rate_limit: {
        primary_window: window(session, 18_000),
        secondary_window: window(weekly, 604_800),
      },
    };
  }
  throw new Error(`Unsupported upstream usage request for ${account.provider}`);
};

const observedQuota = (account, n0) => {
  if (account.provider !== "claude" || account.state) return {};
  const signals = {};
  for (const [index, window] of account.windows.entries()) {
    const bucket = ["5h", "7d", "7d_oi"][index];
    const prefix = `Anthropic-Ratelimit-Unified-${bucket}`;
    const [used, minutes] = window;
    signals[`${prefix}-Utilization`] = String(used / 100);
    if (minutes !== null) signals[`${prefix}-Reset`] = String(Math.floor(at(n0, minutes) / 1000));
  }
  return { quota: { observed_at: new Date(n0).toISOString(), signals } };
};

const json = (response, body) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

NodeHttp.createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    const { scenario, n0 } = JSON.parse(NodeFS.readFileSync(statePath, "utf8"));
    const accounts = scenarios[scenario];
    if (!accounts) return json(response, { files: [] });
    if (request.url.endsWith("/v0/management/auth-files")) {
      return json(response, {
        files: Object.entries(accounts).map(([id, account]) => ({
          id,
          auth_index: id,
          provider: account.provider,
          ...observedQuota(account, n0),
          ...(account.email ? { email: account.email } : {}),
          ...(account.project_id ? { project_id: account.project_id } : {}),
        })),
      });
    }
    if (request.url.endsWith("/v0/management/api-call")) {
      const call = JSON.parse(raw);
      const account = accounts[call.auth_index];
      if (!account) return json(response, { status_code: 404, body: "{}" });
      // "refused" fails every upstream call; "malformed" answers the usage call with the wrong shape.
      if (account.state === "refused") {
        return json(response, { status_code: 403, body: JSON.stringify({ error: "refused" }) });
      }
      if (call.url.endsWith("/userinfo")) {
        return json(response, { status_code: 200, body: JSON.stringify({ id: call.auth_index }) });
      }
      if (call.url.endsWith("/rate-limit-reset-credits")) {
        const credits = Array.from({ length: account.credits ?? 0 }, (_, index) => ({
          id: `${call.auth_index}-credit-${index}`,
          status: "available",
          reset_type: "codex_rate_limits",
          expires_at: new Date(n0 + 3 * 24 * 60 * MINUTE).toISOString(),
        }));
        return json(response, { status_code: 200, body: JSON.stringify({ credits }) });
      }
      const body =
        account.state === "malformed"
          ? { config: "malformed", buckets: "malformed" }
          : usage(account, n0);
      return json(response, { status_code: 200, body: JSON.stringify(body) });
    }
    response.writeHead(404).end();
  });
}).listen(Number(port), "127.0.0.1", () => console.log(`usage limits hub on ${port}`));
