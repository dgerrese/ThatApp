import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on THAT_PORT. This
// uses the that-e2e alias for the app-e2e service (#35), kept for symmetry
// with the `app` service's own that-app alias rather than for the same
// reason: "app" is a real gTLD on Chromium and Firefox's built-in HSTS
// preload list, so a browser silently upgrades a bare http://app to https and
// breaks navigation to the plain-HTTP dev server — a collision "app-e2e"
// itself was never exposed to. See the `app-e2e` service's network alias in
// docker-compose.yml.
const upstream = process.env.THAT_BASE_URL ?? "http://that-e2e:8080";

// The service worker (#12) and window.caches only work in a secure context,
// and plain http:// on a Compose alias is not one — browsers special-case only
// localhost. forward.mjs (#66) gives both engines a genuine http://localhost
// by forwarding TCP to the upstream; it does not start when the upstream is
// already local (CI sets THAT_BASE_URL=http://localhost:8080).
const upstreamIsLocal = ["localhost", "127.0.0.1"].includes(new URL(upstream).hostname);
const baseURL = upstreamIsLocal ? upstream : "http://localhost:8080";

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
  webServer: upstreamIsLocal
    ? undefined
    : {
        command: "node forward.mjs",
        port: 8080,
        reuseExistingServer: false,
        env: { FORWARD_UPSTREAM: upstream },
      },
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
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
