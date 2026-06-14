
'use strict';

// Register event listener for the 'push' event.
self.addEventListener('push', (event) => {
	// Keep the service worker alive until the notification is created.
	const { title, body, tag, data, actions } = event.data.json();

	if (title && body) {
		const { icon } = data;
		delete data.icon;
		const { badge } = data;
		delete data.badge;

		const options = { body, tag, data, icon, badge };

		// Action buttons are not supported everywhere (e.g. Firefox, Safari);
		// Notification.maxActions only exists where they are.
		if (Array.isArray(actions) && typeof Notification !== 'undefined' &&
			'maxActions' in Notification && Notification.maxActions > 0) {
			options.actions = actions.slice(0, Notification.maxActions);
		}

		event.waitUntil(
			self.registration.showNotification(title, options)
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

// Marks a notification read directly against the API. Push notifications are
// usually acted on when no forum window is open, so this cannot rely on
// postMessage to a client — the session cookie and a freshly-fetched csrf
// token are enough to call the write API from the worker itself.
async function markNotificationRead(nid) {
	const base = self.registration.scope;

	const configRes = await fetch(new URL('api/config', base), { credentials: 'same-origin' });
	if (!configRes.ok) {
		return;
	}
	const { csrf_token: csrfToken } = await configRes.json();

	await fetch(new URL(`api/v3/notifications/${encodeURIComponent(nid)}/read`, base), {
		method: 'PUT',
		credentials: 'same-origin',
		headers: { 'x-csrf-token': csrfToken },
	});
}

// Focuses an existing forum window (navigating it via ajaxify) or opens a new one.
function focusOrOpen(target) {
	return self.clients
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
			if (target && self.clients.openWindow) return self.clients.openWindow(target.pathname);
		});
}

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	if (event.action === 'mark-read') {
		const nid = event.notification.data && event.notification.data.nid;
		if (nid) {
			event.waitUntil(markNotificationRead(nid).catch(() => {}));
		}
		return;
	}

	if (event.action === 'view-notifications') {
		event.waitUntil(focusOrOpen(new URL('notifications', self.registration.scope)));
		return;
	}

	let target;
	if (event.notification.data && event.notification.data.url) {
		target = new URL(event.notification.data.url);
	}

	// This looks to see if the current is already open and focuses if it is
	event.waitUntil(focusOrOpen(target));
});
