/* AgriMarket only. No fetch handler, caching, credentials or Takeout changes. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    if (data.type !== "jride-agrimarket" || !["order", "test"].includes(data.kind)) return;
    const expires = Date.parse(data.expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now()) return;
    const code = /^AG-[A-Z0-9-]+$/i.test(data.order_code || "") ? data.order_code : "";
    if (data.kind === "order" && !code) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname.startsWith("/agrimarket/producer")) {
        client.postMessage({ type: "jride-agrimarket-refresh" });
      }
    }
    // Always display the user-visible push, including the harmless test. The page
    // owns its separate foreground sound; the OS controls notification sound.
    await self.registration.showNotification(data.kind === "test" ? "AgriMarket alert test" : "New AgriMarket order", {
      body: data.kind === "test" ? "Test only. No order, payment or driver dispatch was created." : code + " is waiting. Open your farm to respond before it expires.",
      icon: "/favicon.ico", badge: "/favicon.ico", tag: "agrimarket-" + (code || "test"),
      renotify: true, requireInteraction: true,
      data: { order_code: code, expires_at: data.expires_at },
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const code = event.notification.data && event.notification.data.order_code;
    const path = "/agrimarket/producer" + (/^AG-[A-Z0-9-]+$/i.test(code || "") ? "#agri-order-" + code : "");
    const target = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname.startsWith("/agrimarket/producer")) {
        const navigated = await client.navigate(target);
        if (navigated) return navigated.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
