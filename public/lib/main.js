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
			openPending();
		}
	});
	window.addEventListener('focus', openPending);
	window.addEventListener('pageshow', openPending);

	// A tapped notification opens its page. The service worker sends 'web-push:open' when it focuses
	// this window, and also keeps the url in Cache Storage for a minute: on iOS/iPadOS the message is
	// lost while the app is suspended in the background, so the page looks there as soon as it is
	// visible again. Whichever comes first opens the page and removes the stored url.
	function openUrl(url) {
		if (typeof url !== 'string' || !url.startsWith('/')) {
			return;
		}
		const here = window.location.pathname + window.location.search + window.location.hash;
		if (url === here) {
			return;
		}
		if (ajaxify.check(url)) {
			ajaxify.go(url);
		} else {
			window.location.href = url;
		}
	}
	async function takePending() {
		try {
			const cache = await caches.open('web-push-pending');
			const res = await cache.match('/__web-push-pending');
			if (!res) {
				return null;
			}
			await cache.delete('/__web-push-pending');
			const { url, at } = await res.json();
			return Date.now() - at < 60000 ? url : null;
		} catch (e) {
			return null;
		}
	}
	// The tap can be handled a moment after the page is back, so look again for a few seconds.
	let looking = false;
	async function openPending() {
		if (looking || document.visibilityState !== 'visible') {
			return;
		}
		looking = true;
		try {
			for (const wait of [0, 400, 1000, 2000, 3500]) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise(resolve => setTimeout(resolve, wait));
				// eslint-disable-next-line no-await-in-loop
				const url = await takePending();
				if (url) {
					openUrl(url);
					return;
				}
			}
		} finally {
			looking = false;
		}
	}
	navigator.serviceWorker.addEventListener('message', async (event) => {
		const { action, url } = event.data || {};
		if (action === 'web-push:open') {
			await takePending();
			openUrl(url);
		}
	});
	openPending();

	// The first page load may have finished before this script was ready
	listen();
	sync();
})();
