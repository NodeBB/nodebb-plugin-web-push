'use strict';

// NodeBB core skips serviceWorker.register() on Safari (see public/src/app.js).
// That predates iOS 16.4, where Safari/PWA does support Web Push. Without an SW,
// navigator.serviceWorker.ready hangs forever and our settings page silently fails.
// This script registers the SW ourselves on Safari/iOS, and logs every lifecycle
// event so failures surface in Web Inspector instead of disappearing.

(async () => {
	const [hooks] = await app.require(['hooks']);

	hooks.on('action:app.load', async () => {
		if (!('serviceWorker' in navigator)) {
			console.warn('[web-push] serviceWorker not supported');
			return;
		}

		const ua = navigator.userAgent;
		const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
		const isIOS = /iPad|iPhone|iPod/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

		if (!isSafari && !isIOS) {
			// Core handles registration on non-Safari browsers.
			return;
		}

		// Core already tried (and skipped) registration by this point. If something
		// is registered, leave it alone.
		const existing = await navigator.serviceWorker.getRegistration();
		if (existing) {
			console.info('[web-push] SW already registered:', existing);
			return;
		}

		const swUrl = (config.relative_path || '') + '/service-worker.js';
		const scope = (config.relative_path || '') + '/';

		console.info('[web-push] Registering service worker (Safari/iOS fallback):', { swUrl, scope });

		let registration;
		try {
			registration = await navigator.serviceWorker.register(swUrl, { scope });
			console.info('[web-push] register() resolved:', registration);
		} catch (err) {
			console.error('[web-push] register() FAILED:', err);
			console.error('[web-push] Failure name:', err && err.name);
			console.error('[web-push] Failure message:', err && err.message);
			return;
		}

		const logState = (worker, label) => {
			if (!worker) return;
			console.info(`[web-push] ${label} initial state:`, worker.state);
			worker.addEventListener('statechange', () => {
				console.info(`[web-push] ${label} state →`, worker.state);
			});
			worker.addEventListener('error', (e) => {
				console.error(`[web-push] ${label} error event:`, e);
			});
		};

		logState(registration.installing, 'installing');
		logState(registration.waiting, 'waiting');
		logState(registration.active, 'active');

		registration.addEventListener('updatefound', () => {
			console.info('[web-push] updatefound — new worker installing');
			logState(registration.installing, 'installing(updatefound)');
		});

		navigator.serviceWorker.addEventListener('error', (e) => {
			console.error('[web-push] navigator.serviceWorker error:', e);
		});

		try {
			const ready = await navigator.serviceWorker.ready;
			console.info('[web-push] serviceWorker.ready resolved:', ready);
		} catch (err) {
			console.error('[web-push] serviceWorker.ready rejected:', err);
		}
	});
})();
