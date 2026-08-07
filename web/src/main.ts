async function showServerStatus(): Promise<void> {
  const el = document.querySelector<HTMLElement>("#status");
  if (!el) return;

  try {
    const res = await fetch("/api/health");
    const body = (await res.json()) as { status?: string };
    el.textContent = body.status === "ok" ? "Server is up." : "Server reported a problem.";
  } catch {
    el.textContent = "Could not reach the server.";
  }
}

void showServerStatus();
