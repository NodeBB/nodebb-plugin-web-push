'use strict';

// Invites logged-in users to enable push notifications via a corner banner,
// shown after a configurable number of page loads (see ACP settings).
// Visit count and dismissal are tracked per-device in localStorage.

(async () => {
	const [hooks, api, alerts, storage] = await app.require(['hooks', 'api', 'alerts', 'storage']);

	const visitsKey = 'web-push:visits';
	const dismissedKey = 'web-push:prompt-dismissed';

	hooks.on('action:app.load', async () => {
		const { promptEnabled, promptDelay, vapidKey } = config['web-push'] || {};
		if (!promptEnabled || !vapidKey || !app.user.uid || storage.getItem(dismissedKey)) {
			return;
		}

		if (!('serviceWorker' in navigator) || !('PushManager' in window) ||
			Notification.permission === 'denied') {
			return;
		}

		const registration = await navigator.serviceWorker.getRegistration();
		if (!registration || await registration.pushManager.getSubscription()) {
			return;
		}

		const visits = (parseInt(storage.getItem(visitsKey), 10) || 0) + 1;
		storage.setItem(visitsKey, visits);
		if (visits < promptDelay) {
			return;
		}

		showBanner(registration);
	});

	async function showBanner(registration) {
		const $banner = await app.parseAndTranslate('partials/web-push/prompt', {});
		const banner = $banner.get(0);
		document.body.append(banner);

		banner.addEventListener('click', (e) => {
			const btn = e.target.closest('[data-action]');
			if (!btn) {
				return;
			}

			if (btn.dataset.action === 'subscribe') {
				subscribe(registration);
			}

			storage.setItem(dismissedKey, '1');
			banner.remove();
		});
	}

	async function subscribe(registration) {
		try {
			// As in settings.js: when permission is already granted there is no
			// await before subscribe(), keeping the call within the click's user
			// activation (iOS Safari requires this).
			if (Notification.permission !== 'granted' &&
				await Notification.requestPermission() !== 'granted') {
				alerts.warning('[[web-push:toast.permission_denied]]');
				return;
			}

			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(config['web-push'].vapidKey),
			});
			await api.post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
			alerts.success('[[web-push:toast.subscribe_success]]');
		} catch (err) {
			console.error('[web-push] subscribing from prompt failed:', err);
			alerts.warning('[[web-push:toast.subscribe_failed]]');
		}
	}

	// Chrome doesn't accept a base64 string for applicationServerKey
	// https://bugs.chromium.org/p/chromium/issues/detail?id=802280
	function urlBase64ToUint8Array(base64String) {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}
})();
