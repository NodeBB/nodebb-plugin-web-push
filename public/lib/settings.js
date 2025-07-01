
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
						try {
							subscription = await registration.pushManager.subscribe({
								userVisibleOnly: true,
								applicationServerKey: convertedVapidKey,
							});

							await post('/plugins/web-push/subscription', { subscription: subscription.toJSON() });

							// Update count
							let count = parseInt(countEl.textContent, 10);
							count += 1;
							countEl.innerText = count;
						} catch (e) {
							subselector.checked = false;
						}
					} else {
						await subscription.unsubscribe();
						await del('/plugins/web-push/subscription', { subscription: subscription.toJSON() });
						let count = parseInt(countEl.textContent, 10);
						count -= 1;
						countEl.innerText = count;
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
	var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	var base64 = (base64String + padding)
		.replace(/-/g, '+')
		.replace(/_/g, '/');

	var rawData = window.atob(base64);
	var outputArray = new Uint8Array(rawData.length);

	for (var i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}
