import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on THAT_PORT. This
// uses the that-e2e alias for the app-e2e service (CB#35), kept for symmetry
// with the `app` service's own that-app alias rather than for the same
// reason: "app" is a real gTLD on Chromium and Firefox's built-in HSTS
// preload list, so a browser silently upgrades a bare http://app to https and
// breaks navigation to the plain-HTTP dev server — a collision "app-e2e"
// itself was never exposed to. See the `app-e2e` service's network alias in
// docker-compose.yml.
const upstream = process.env.THAT_BASE_URL ?? "http://that-e2e:8080";

// The service worker (CB#12) and window.caches only work in a secure context,
// and plain http:// on a Compose alias is not one — browsers special-case only
// localhost. forward.mjs (CB#66) gives both engines a genuine http://localhost
// by forwarding TCP to the upstream; it does not start when THAT_BASE_URL
// already names localhost.
const upstreamIsLocal = ["localhost", "127.0.0.1"].includes(new URL(upstream).hostname);
const baseURL = upstreamIsLocal ? upstream : "http://localhost:8080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  // One worker per vCPU on GitHub's ubuntu-latest (4 vCPU / 16G), above the
  // half-CPUs Playwright's default would pick. It was set on Codeberg, whose
  // runner reported the host's cores and asked for sixteen browsers; sixteen
  // Firefox profiles on four CPUs failed on timeouts and lost contexts. Two is
  // the next step down if four thrashes. Tracks `runs-on` in
  // .github/workflows/ci.yml. Unset locally, where the default is right.
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
    // began claiming /api/issues and /api/pins (CB#12 task 5), a stub of either
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
