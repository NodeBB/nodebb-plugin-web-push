
'use strict';

import { post, del } from 'api';
import { success, warning } from 'alerts';

export async function init() {
	const containerEl = document.querySelector('[component="web-push-form"]');
	if (!containerEl) {
		return;
	}

	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		warning('[[web-push:toast.unsupported]]');
		return;
	}

	// navigator.serviceWorker.ready hangs forever if no SW is registered; race against a timeout.
	const registration = await Promise.race([
		navigator.serviceWorker.ready,
		new Promise((_, reject) => setTimeout(() => reject(), 5000)),
	]).catch(() => {
		warning('[[web-push:toast.sw_not_registered]]');
		return null;
	});
	if (!registration) {
		return;
	}

	let subscription = await registration.pushManager.getSubscription();
	const convertedVapidKey = urlBase64ToUint8Array(config['web-push'].vapidKey);

	containerEl.addEventListener('click', async (e) => {
		const subselector = e.target.closest('[data-action]');
		if (subselector) {
			const action = e.target.getAttribute('data-action');

			switch (action) {
				case 'test': {
					if (subscription) {
						await post('/plugins/web-push/test', { subscription });
						success('[[web-push:toast.test_success]]');
					} else {
						warning('[[web-push:toast.test_unavailable]]');
					}
					break;
				}

				case 'toggle': {
					const countEl = document.querySelector('#deviceCount strong');
					if (!subscription) {
						if (Notification.permission === 'denied') {
							subselector.checked = false;
							warning('[[web-push:toast.permission_denied]]');
							document.getElementById('permission-warning').classList.remove('d-none');
							break;
						}

						try {
							if (Notification.permission !== 'granted') {
								const permission = await Notification.requestPermission();
								if (permission !== 'granted') {
									subselector.checked = false;
									warning('[[web-push:toast.permission_denied]]');
									document.getElementById('permission-warning').classList.remove('d-none');
									break;
								}
							}

							subscription = await registration.pushManager.subscribe({
								userVisibleOnly: true,
								applicationServerKey: convertedVapidKey,
							});

							await post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
							success('[[web-push:toast.subscribe_success]]');

							let count = parseInt(countEl.textContent, 10);
							countEl.innerText = count + 1;
						} catch (err) {
							subselector.checked = false;
							const stale = await registration.pushManager.getSubscription();
							if (stale) {
								await stale.unsubscribe();
							}
							subscription = null;
							warning('[[web-push:toast.subscribe_failed]]');
						}
					} else {
						await subscription.unsubscribe();
						await del('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
						let count = parseInt(countEl.textContent, 10);
						countEl.innerText = count - 1;
						subscription = null;
					}

					break;
				}
			}
		}
	});

	const enabledEl = document.getElementById('enabled');
	if (subscription) {
		enabledEl.checked = true;
	}

	const state = await registration.pushManager.permissionState({
		userVisibleOnly: true,
		applicationServerKey: convertedVapidKey,
	});
	if (state === 'denied') {
		document.getElementById('permission-warning').classList.remove('d-none');
	}
}

// https://bugs.chromium.org/p/chromium/issues/detail?id=802280
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding)
		.replace(/-/g, '+')
		.replace(/_/g, '/');

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}
