import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on WD_PORT. This
// uses the wd-app alias, not the app service name: "app" is a real gTLD on
// Chromium and Firefox's built-in HSTS preload list, so a browser silently
// upgrades http://app to https and breaks navigation to the plain-HTTP dev
// server. See the `app` service's network alias in docker-compose.yml.
const baseURL = process.env.WD_BASE_URL ?? "http://wd-app:8080";

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
