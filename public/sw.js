// Shows push notifications, and opens the right page when one is clicked. Holds no data of its own.
self.addEventListener("push", (event) => {
  const message = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(message.title || "New notification", {
      body: message.body || "",
      data: { link: message.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.link));
});
