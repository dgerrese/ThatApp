// Gives the browsers a genuine http://localhost (#66). A service worker and
// window.caches need a secure context, and plain HTTP only has one on
// localhost — per-engine flags that fake it for another hostname either miss
// CacheStorage (Firefox) or only reach the browser, not Node (Chromium).
import net from "node:net";

if (!process.env.THAT_UPSTREAM) {
  throw new Error("THAT_UPSTREAM is required — set by playwright.config.ts's webServer.env");
}
const upstream = new URL(process.env.THAT_UPSTREAM);
const listenPort = Number(process.env.THAT_FORWARD_PORT ?? "8080");

net
  .createServer((client) => {
    const server = net.connect(Number(upstream.port || 80), upstream.hostname);
    client.pipe(server).pipe(client);
    client.on("error", () => server.destroy());
    server.on("error", () => client.destroy());
  })
  .listen(listenPort, "127.0.0.1");
