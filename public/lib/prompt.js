'use strict';

// Invites logged-in users to enable push notifications via a corner banner,
// shown after a configurable number of page loads (see ACP settings).
// Visit count and dismissal are tracked per-device in localStorage.

(async () => {
	const [hooks, api, translator, alerts] = await app.require(['hooks', 'api', 'translator', 'alerts']);

	const visitsKey = 'web-push:visits';
	const dismissedKey = 'web-push:prompt-dismissed';

	hooks.on('action:app.load', async () => {
		const { promptEnabled, promptDelay, vapidKey } = config['web-push'] || {};
		if (!promptEnabled || !vapidKey || !app.user.uid || localStorage.getItem(dismissedKey)) {
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

		const visits = (parseInt(localStorage.getItem(visitsKey), 10) || 0) + 1;
		localStorage.setItem(visitsKey, visits);
		if (visits < promptDelay) {
			return;
		}

		showBanner(registration);
	});

	async function showBanner(registration) {
		// z-index keeps the banner below bootstrap modals (1055)
		const html = await translator.translate(`
			<div component="web-push/prompt" class="card position-fixed bottom-0 end-0 m-3 shadow" style="max-width: 20rem; z-index: 1045;">
				<div class="card-body">
					<h6 class="card-title fw-bold"><i class="fa fa-bell text-primary"></i> [[web-push:prompt.title]]</h6>
					<p class="card-text small text-muted">[[web-push:prompt.body]]</p>
					<div class="d-flex justify-content-end gap-2">
						<button type="button" class="btn btn-sm btn-link text-muted" data-action="dismiss">[[web-push:prompt.dismiss]]</button>
						<button type="button" class="btn btn-sm btn-primary" data-action="subscribe">[[web-push:prompt.confirm]]</button>
					</div>
				</div>
			</div>
		`);

		const wrapper = document.createElement('div');
		wrapper.innerHTML = html;
		const banner = wrapper.firstElementChild;
		document.body.append(banner);

		banner.addEventListener('click', (e) => {
			const btn = e.target.closest('[data-action]');
			if (!btn) {
				return;
			}

			if (btn.dataset.action === 'subscribe') {
				subscribe(registration);
			}

			localStorage.setItem(dismissedKey, '1');
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
