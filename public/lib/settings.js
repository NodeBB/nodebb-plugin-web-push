
'use strict';

import { post, del } from 'api';
import { success, warning } from 'alerts';

export async function init() {
	const containerEl = document.querySelector('[component="web-push-form"]');
	if (!containerEl) {
		console.error('Web Push form container not found');
		return;
	}

	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		console.error('[web-push] Service workers or Push API not supported in this browser');
		warning('[[web-push:toast.unsupported]]');
		return;
	}

	// navigator.serviceWorker.ready never rejects — it hangs forever if no SW is registered.
	// On iOS this is a common failure mode (PWA not installed, scope mismatch, core SW failed
	// to register). Race it against a timeout so we surface the problem instead of hanging.
	const registration = await Promise.race([
		navigator.serviceWorker.ready,
		new Promise((_, reject) => setTimeout(
			() => reject(new Error('Service worker not ready after 5s — likely not registered')),
			5000
		)),
	]).catch((err) => {
		console.error('[web-push]', err);
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
						// iOS Safari is strict about user activation: subscribe() must be
						// called from the same synchronous task as the click. We branch BEFORE
						// any await: if permission is already granted, call subscribe() first
						// (no awaits in between). Otherwise request permission, which itself
						// preserves activation on Chrome but may lose it on iOS — the user can
						// just tap again.
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

							// Update count
							let count = parseInt(countEl.textContent, 10);
							count += 1;
							countEl.innerText = count;
						} catch (err) {
							console.error('[web-push] subscribe failed:', err);
							subselector.checked = false;
							// Roll back any browser-level subscription created before the failure.
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
