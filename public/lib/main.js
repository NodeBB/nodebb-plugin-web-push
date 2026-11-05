'use strict';

/**
 * Keeps the push notifications shown on this device in sync with the forum: while a forum
 * page is open, ask the service worker to close notifications that were already read
 * (here or on another device). See `webPushCloseReadNotifications` in static/web-push.js.
 */
(async () => {
	if (!('serviceWorker' in navigator) || !('Notification' in window)) {
		return;
	}

	const [hooks] = await app.require(['hooks']);
	let timer;

	function sync() {
		if (!app.user || !app.user.uid || Notification.permission !== 'granted') {
			return;
		}

		// Debounce: several triggers usually fire together (e.g. ajaxify.end + updateCount)
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				const registration = await navigator.serviceWorker.getRegistration(`${config.relative_path}/`);
				if (registration && registration.active) {
					registration.active.postMessage({ action: 'web-push:sync' });
				}
			} catch (e) {
				// no service worker – nothing to do
			}
		}, 1000);
	}

	// The unread count changes when notifications are read here or on another device
	let listening = false;
	function listen() {
		if (!listening && window.socket) {
			socket.on('event:notifications.updateCount', sync);
			listening = true;
		}
	}

	hooks.on('action:ajaxify.end', () => {
		listen();
		sync();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			sync();
		}
	});

	// The first page load may have finished before this script was ready
	listen();
	sync();
})();
