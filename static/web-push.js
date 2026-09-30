
'use strict';

/**
 * Closes the notifications currently shown on this device that are no longer unread
 * on the forum (e.g. they were read on another device), keeping `exceptTag` open.
 *
 * Runs when a new push arrives and when an open forum page asks for it (see public/lib/main.js).
 * It never sends a push by itself, so it works everywhere — including iOS/iPadOS, where every
 * push must display a notification.
 */
async function webPushCloseReadNotifications(exceptTag) {
	if (!self.registration.getNotifications) {
		return;
	}

	// Only notifications created by this plugin carry a tag and a target url
	const shown = (await self.registration.getNotifications())
		.filter(n => n.tag && n.tag !== exceptTag && n.data && n.data.url);
	if (!shown.length) {
		return;
	}

	let tags;
	try {
		const res = await fetch(new URL('api/v3/plugins/web-push/unread-tags', self.registration.scope), {
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { accept: 'application/json' },
		});
		if (!res.ok) {
			return; // e.g. logged out or offline – leave everything as is
		}
		({ tags } = (await res.json()).response || {});
	} catch (e) {
		return;
	}
	if (!Array.isArray(tags)) {
		return;
	}

	const unread = new Set(tags.map(String));
	shown.forEach((notification) => {
		if (!unread.has(String(notification.tag))) {
			notification.close();
		}
	});
}

// Register event listener for the 'push' event.
self.addEventListener('push', (event) => {
	// Keep the service worker alive until the notification is created.
	const { title, body, tag, data } = event.data.json();

	if (title && body) {
		const { icon } = data;
		delete data.icon;
		const { badge } = data;
		delete data.badge;

		event.waitUntil(
			self.registration.showNotification(title, { body, tag, data, icon, badge })
				.then(() => webPushCloseReadNotifications(tag).catch(() => {}))
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

// An open forum page asks us to sync (after navigation, when it becomes visible,
// or when the unread notification count changes)
self.addEventListener('message', (event) => {
	if (event.data && event.data.action === 'web-push:sync') {
		event.waitUntil(webPushCloseReadNotifications().catch(() => {}));
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
