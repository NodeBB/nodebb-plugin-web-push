
'use strict';

import { post, del } from 'api';
import { success, warning } from 'alerts';

export async function init() {
	const containerEl = document.querySelector('[component="web-push-form"]');
	if (!containerEl) {
		console.error('Web Push form container not found');
		return;
	}
	const registration = await navigator.serviceWorker.ready;
	let subscription = await registration.pushManager.getSubscription();
	const convertedVapidKey = urlBase64ToUint8Array(config['web-push'].vapidKey);

	containerEl.addEventListener('click', async (e) => {
		const subselector = e.target.closest('[data-action]');
		if (subselector) {
			const action = subselector.getAttribute('data-action');

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

				case 'remove': {
					const endpoint = subselector.getAttribute('data-endpoint');
					await del('/plugins/web-push/subscription', { subscription: { endpoint } });
					ajaxify.refresh();
					break;
				}

				case 'toggle': {
					if (!subscription) {
						try {
							subscription = await registration.pushManager.subscribe({
								userVisibleOnly: true,
								applicationServerKey: convertedVapidKey,
							});

							await post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
							ajaxify.refresh();
						} catch (e) {
							subselector.checked = false;
						}
					} else {
						await subscription.unsubscribe();
						await del('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
						subscription = null;
						ajaxify.refresh();
					}

					break;
				}
			}
		}
	});

	const enabledEl = document.getElementById('enabled');
	const devices = ajaxify.data.devices || [];
	if (subscription && devices.some(d => d.endpoint === subscription.endpoint)) {
		enabledEl.checked = true;
	} else if (subscription) {
		await subscription.unsubscribe();
		subscription = null;
	}

	// Show permission warning if applicable
	const state = await registration.pushManager.permissionState({
		userVisibleOnly: true,
		applicationServerKey: convertedVapidKey,
	});
	if (state === 'denied') {
		const warningEl = document.getElementById('permission-warning');
		warningEl.classList.remove('d-none');
	}
}

// This function is needed because Chrome doesn't accept a base64 encoded string
// as value for applicationServerKey in pushManager.subscribe yet
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
