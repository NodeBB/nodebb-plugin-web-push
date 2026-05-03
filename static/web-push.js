
'use strict';

// Register event listener for the 'push' event.
self.addEventListener('push', (event) => {
	// Keep the service worker alive until the notification is created.
	const { title, body, tag, data } = event.data.json();

	if (title && body) {
		const { icon, mergeId } = data;
		delete data.icon;
		const { badge } = data;
		delete data.badge;

		// Close any existing notifications with the same mergeId (for Safari compatibility)
		// Safari doesn't properly support the 'tag' property for replacing notifications
		const closePromise = mergeId
			? self.registration.getNotifications().then((notifications) => {
				notifications.forEach((notification) => {
					if (notification.data && notification.data.mergeId === mergeId) {
						notification.close();
					}
				});
			})
			: Promise.resolve();

		event.waitUntil(
			closePromise.then(() => {
				return self.registration.showNotification(title, { body, tag, data, icon, badge });
			})
		);
	} else if (tag) {
		event.waitUntil(
			self.registration.getNotifications({ tag }).then((notifications) => {
				notifications.forEach((notification) => {
					notification.close();
				});
			})
		);
	}
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	let target;
	if (event.notification.data && event.notification.data.url) {
		target = new URL(event.notification.data.url);
	}

	// This looks to see if the current is already open and focuses if it is
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window' })
			.then((clientList) => {
				for (const client of clientList) {
					const { hostname } = new URL(client.url);
					if (target && hostname === target.hostname && 'focus' in client) {
						client.postMessage({
							action: 'ajaxify',
							url: target.pathname,
						});
						return client.focus();
					}
				}
				if (self.clients.openWindow) return self.clients.openWindow(target.pathname);
			})
	);
});
