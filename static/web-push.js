
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

// The page a tapped notification should open, when an existing window is focused. iOS/iPadOS
// suspends a home-screen app in the background: the message sent to it is dropped, and the
// service worker itself is stopped right after the click, so the url is kept in Cache Storage,
// which the page reads when it becomes visible again (public/lib/main.js).
const WEB_PUSH_PENDING_CACHE = 'web-push-pending';
const WEB_PUSH_PENDING_KEY = '/__web-push-pending';
async function webPushSetPending(url) {
	try {
		const cache = await caches.open(WEB_PUSH_PENDING_CACHE);
		await cache.put(WEB_PUSH_PENDING_KEY, new Response(JSON.stringify({ url, at: Date.now() }), {
			headers: { 'content-type': 'application/json' },
		}));
	} catch (e) {
		// no Cache Storage – the message below is all we have
	}
}

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	let target;
	if (event.notification.data && event.notification.data.url) {
		target = new URL(event.notification.data.url);
	}

	// Stored first, in every case: on iOS/iPadOS the app may come to the front before this handler
	// runs, or matchAll may not see the suspended window; the page picks the url up either way.
	const targetUrl = target ? target.pathname + target.search + target.hash : null;
	const pending = target ? webPushSetPending(targetUrl) : Promise.resolve();

	// This looks to see if the current is already open and focuses if it is
	event.waitUntil(pending.then(() => self.clients
		.matchAll({ type: 'window' })
		.then((clientList) => {
			// iOS/iPadOS home-screen apps have a single window: openWindow loads the page in it,
			// while a message to the suspended window is lost. Also try navigate() where available.
			const ua = (self.navigator && self.navigator.userAgent) || '';
			if (target && /iPhone|iPad|iPod/.test(ua) && self.clients.openWindow) {
				const own = clientList.find(c => new URL(c.url).hostname === target.hostname);
				if (own && 'navigate' in own) {
					return own.navigate(targetUrl).then(c => (c || own).focus()).catch(() => self.clients.openWindow(targetUrl));
				}
				return self.clients.openWindow(targetUrl);
			}
			for (const client of clientList) {
				const { hostname } = new URL(client.url);
				if (target && hostname === target.hostname && 'focus' in client) {
					client.postMessage({ action: 'web-push:open', url: targetUrl });
					return client.focus();
				}
			}
			if (target && self.clients.openWindow) return self.clients.openWindow(targetUrl);
		}))
	);
});
