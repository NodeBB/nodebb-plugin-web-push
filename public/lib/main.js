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

	// This device remembers the endpoint it registered (settings.js and below), so a subscription
	// that disappears without the member turning it off can be told apart from one that was
	// switched off on purpose (settings.js forgets the endpoint then).
	const endpointKey = () => `web-push:endpoint:${app.user.uid}`;
	function rememberEndpoint(endpoint) {
		try {
			if (endpoint) {
				localStorage.setItem(endpointKey(), endpoint);
			} else {
				localStorage.removeItem(endpointKey());
			}
		} catch (e) {
			// no storage – recovery is simply not available here
		}
	}
	function rememberedEndpoint() {
		try {
			return localStorage.getItem(endpointKey());
		} catch (e) {
			return null;
		}
	}

	function urlBase64ToUint8Array(base64String) {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const raw = window.atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(raw, c => c.charCodeAt(0));
	}

	// iOS/iPadOS cancel a home-screen app's subscription on their own (e.g. when a push was not
	// shown because the service worker was being replaced), do not tell the site
	// (no pushsubscriptionchange), and allow subscribing again only from a user gesture. When this
	// device had notifications on and its subscription is gone while permission is still granted,
	// subscribe again on the member's next tap anywhere in the forum (no prompt is shown, the
	// permission is already there), register it, and drop the dead endpoint from the forum.
	let recoveryArmed = false;
	function armRecovery(registration, oldEndpoint) {
		if (recoveryArmed || !config['web-push'] || !config['web-push'].vapidKey) {
			return;
		}
		recoveryArmed = true;
		const events = ['touchend', 'click'];
		const recover = async () => {
			events.forEach(type => document.removeEventListener(type, recover, true));
			try {
				const subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(config['web-push'].vapidKey),
				});
				const [api] = await app.require(['api']);
				await api.post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
				if (oldEndpoint && oldEndpoint !== subscription.endpoint) {
					await api.del('/plugins/web-push/subscription', { subscription: { endpoint: oldEndpoint } }).catch(() => {});
				}
				rememberEndpoint(subscription.endpoint);
			} catch (e) {
				// not allowed any more (e.g. notifications turned off in the device settings): stop trying
				rememberEndpoint(null);
			}
		};
		events.forEach(type => document.addEventListener(type, recover, { capture: true, passive: true }));
	}

	// Keep the forum's copy of this device's subscription current. Browsers (Safari/iOS in
	// particular) replace the endpoint on their own; the forum then keeps sending to the old one and
	// this device gets nothing. Once a day, re-register whatever the browser has now. Adding an
	// endpoint the forum already has only refreshes it. On every page load, check whether a
	// subscription this device had is gone (see armRecovery).
	async function refreshSubscription() {
		if (!app.user || !app.user.uid || Notification.permission !== 'granted' || !('PushManager' in window)) {
			return;
		}
		let registration;
		let subscription;
		try {
			registration = await navigator.serviceWorker.getRegistration(`${config.relative_path}/`);
			subscription = registration && await registration.pushManager.getSubscription();
		} catch (e) {
			return;
		}
		if (!registration) {
			return;
		}
		if (!subscription) {
			const lost = rememberedEndpoint();
			if (lost) {
				armRecovery(registration, lost);
			}
			return;
		}
		if (rememberedEndpoint() !== subscription.endpoint) {
			rememberEndpoint(subscription.endpoint);
		}

		const key = `web-push:refreshed:${app.user.uid}`;
		try {
			if (Date.now() - (parseInt(localStorage.getItem(key), 10) || 0) < 24 * 60 * 60 * 1000) {
				return;
			}
		} catch (e) {
			return; // no storage: skip rather than post on every page
		}
		try {
			const [api] = await app.require(['api']);
			await api.post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
			localStorage.setItem(key, String(Date.now()));
		} catch (e) {
			// try again on the next page load
		}
	}

	hooks.on('action:ajaxify.end', refreshSubscription);

	// The first page load may have finished before this script was ready
	listen();
	sync();
	refreshSubscription();
})();
