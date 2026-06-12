'use strict';

// NodeBB core skips serviceWorker.register() on Safari (see public/src/app.js).
// That predates iOS 16.4, where Safari/PWA does support Web Push. Without an SW,
// navigator.serviceWorker.ready hangs forever and our settings page silently fails.
// This script registers the SW ourselves on Safari/iOS.

(async () => {
	const [hooks] = await app.require(['hooks']);

	hooks.on('action:app.load', async () => {
		if (!('serviceWorker' in navigator)) {
			return;
		}

		// Mirror core's own condition (config.useragent.isSafari) so the two
		// checks can never disagree: core skips exactly when we register.
		if (!config.useragent || !config.useragent.isSafari) {
			return;
		}

		// Core already tried (and skipped) registration by this point. If something
		// is registered, leave it alone.
		const existing = await navigator.serviceWorker.getRegistration();
		if (existing) {
			return;
		}

		const swUrl = (config.relative_path || '') + '/service-worker.js';
		const scope = (config.relative_path || '') + '/';

		try {
			await navigator.serviceWorker.register(swUrl, { scope });
		} catch (err) {
			console.error('[web-push] service worker registration failed:', err);
		}
	});
})();
