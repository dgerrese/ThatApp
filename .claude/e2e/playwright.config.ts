import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on THAT_PORT. This
// uses the that-app alias, not the app service name: "app" is a real gTLD on
// Chromium and Firefox's built-in HSTS preload list, so a browser silently
// upgrades http://app to https and breaks navigation to the plain-HTTP dev
// server. See the `app` service's network alias in docker-compose.yml.
const baseURL = process.env.THAT_BASE_URL ?? "http://that-app:8080";

// The service worker (#12) only registers in a secure context, and plain
// http:// on a Compose service alias is not one — browsers special-case only
// localhost/127.0.0.1. Each engine gets there differently: Firefox has a
// per-hostname secure-context allowlist pref; Chromium's equivalent flag
// (--unsafely-treat-insecure-origin-as-secure) is unreliable under headless
// (microsoft/playwright#22944), so Chromium instead resolves "localhost" —
// which it always treats as secure — to the real host and navigates there.
const { hostname, port } = new URL(baseURL);
const localhostURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  // Playwright sizes its pool as half of `os.cpus()`, and inside a Forgejo
  // runner that call reports the *host's* logical cores rather than the
  // cgroup's share — on codeberg-medium (4 CPU / 8G) it asked for sixteen
  // browsers. Chromium survived it; sixteen Firefox profiles on four CPUs did
  // not, and the suite failed on timeouts and lost browser contexts. Four is
  // one worker per vCPU, deliberately above the half-CPUs the default
  // heuristic would pick, chosen because codeberg-medium caps a job at ten
  // minutes and there is little room to spare. Two is the next step down if
  // four still thrashes. Tracks the `runs-on: codeberg-medium` in
  // .forgejo/workflows/e2e.yml — move that runner label and this number
  // stops being justified. Unset locally, where the default is right.
  workers: process.env.CI ? 4 : undefined,
  use: {
    baseURL,
    trace: "retain-on-failure",
    // A request a service worker claims is invisible to page.route, and to
    // context.route on every engine but Chromium — Playwright intercepts a
    // worker's own fetches there and nowhere else. So from the moment sw.ts
    // began claiming /api/issues and /api/pins (#12 task 5), a stub of either
    // path would be silently bypassed on a controlled page and the request
    // would reach the real server, which shares the dev database and fans out
    // to the owner's Jira instances. Blocking registration by default keeps
    // every spec's stubs authoritative and its failures honest; pwa.spec.ts,
    // the one suite that is about the worker, opts back in with
    // test.use({ serviceWorkers: "allow" }).
    serviceWorkers: "block",
  },
  projects: [
    // Firefox first: it is the primary target.
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: { "dom.securecontext.allowlist": hostname },
        },
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localhostURL,
        launchOptions: {
          args: [`--host-resolver-rules=MAP localhost ${hostname}`],
        },
      },
    },
  ],
});
