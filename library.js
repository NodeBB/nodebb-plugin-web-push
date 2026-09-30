'use strict';

const webPush = require('web-push');

const nconf = nodebb.require('nconf');
const winston = nodebb.require('winston');

const db = nodebb.require('./src/database');
const request = nodebb.require('./src/request');
const user = nodebb.require('./src/user');
const meta = nodebb.require('./src/meta');
const utils = nodebb.require('./src/utils');
const translator = nodebb.require('./src/translator');
const notifications = nodebb.require('./src/notifications');

const routeHelpers = nodebb.require('./src/routes/helpers');

const controllers = require('./lib/controllers');
const subscriptions = require('./lib/subscriptions');
const unread = require('./lib/unread');

const plugin = module.exports;

// Apple's push service (Safari, iOS/iPadOS home-screen apps) only accepts pushes that display a
// notification. Pushes that do not (like the "close this notification" push of .rescind) count
// against the site, and after a few of them the subscription is revoked: the toggle on the
// device turns itself off. .rescind therefore skips these endpoints.
const SILENT_PUSH_UNSUPPORTED = new Set(['web.push.apple.com']);

// Push services reject payloads over 4096 bytes (encrypted); keep ours well below that.
const MAX_PAYLOAD_BYTES = 3500;

function endpointHost(subscription) {
	try {
		return new URL(subscription.endpoint).host;
	} catch (e) {
		return '';
	}
}

// One place for every failed send: log it with the push service and its answer, and drop the
// subscription when it can never work again (expired / unsubscribed / unusable keys).
async function onSendError(uid, subscription, e) {
	const body = typeof e.body === 'string' ? e.body.replace(/\s+/g, ' ').slice(0, 200) : '';
	const gone = e.statusCode === 404 || e.statusCode === 410 ||
		e.code === 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY' || /public key|auth secret|p256dh/i.test(e.message || '');
	winston.info(`[plugins/web-push] Push failed (uid ${uid}, ${endpointHost(subscription) || 'invalid endpoint'}): ` +
		`${e.code}; ${e.message}; statusCode: ${e.statusCode}${body ? `; ${body}` : ''}${gone ? ' – subscription removed' : ''}`);
	if (gone && uid) {
		await subscriptions.remove(uid, subscription).catch(err => winston.warn(`[plugins/web-push] ${err.message}`));
	}
}

plugin.init = async (params) => {
	const { router, middleware/* , controllers */ } = params;
	const accountMiddlewares = [
		middleware.exposeUid,
		middleware.ensureLoggedIn,
		middleware.canViewUsers,
		middleware.checkAccountPermissions,
		middleware.buildAccountData,
	];

	await assertVapidConfiguration();

	routeHelpers.setupPageRoute(router, '/user/:userslug/web-push', accountMiddlewares, controllers.renderSettings);

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/web-push', controllers.renderAdminPage);
};

plugin.appendConfig = async (config) => {
	const { publicKey } = await meta.settings.get('web-push');
	config['web-push'] = {
		vapidKey: publicKey,
	};

	return config;
};

plugin.registerServiceWorker = async (data) => {
	const { scripts } = data;
	// The static file is served with a long max-age and imported scripts are fetched through the
	// HTTP cache, so without a cache buster the generated service-worker.js never changes and
	// browsers keep running the old code after the plugin is upgraded. The buster changes on every
	// build, which makes browsers install the updated service worker.
	const buster = meta.config['cache-buster'];
	scripts.add(`nodebb-plugin-web-push/static/web-push.js${buster ? `?${buster}` : ''}`);
	return data;
};

async function assertVapidConfiguration() {
	let { publicKey, privateKey } = await meta.settings.get('web-push');
	if (!publicKey || !privateKey) {
		winston.warn('[plugins/web-push] VAPID key pair not found or invalid, regenerating.');
		({ publicKey, privateKey } = webPush.generateVAPIDKeys());
		await meta.settings.set('web-push', { publicKey, privateKey });
	} else {
		winston.info('[plugins/web-push] VAPID keys OK.');
	}

	webPush.setVapidDetails(
		nconf.get('url'),
		publicKey,
		privateKey
	);
}

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const middlewares = [
		middleware.ensureLoggedIn,
		// middleware.admin.checkPrivileges,
	];

	routeHelpers.setupApiRoute(router, 'post', '/web-push/subscription', middlewares, async (req, res) => {
		if (!req.uid) {
			return helpers.formatApiResponse(204, res);
		}

		const { subscription } = req.body;
		const device = req.useragent ? {
			browser: req.useragent.browser,
			version: req.useragent.version,
			os: req.useragent.os,
			platform: req.useragent.platform,
		} : undefined;
		await subscriptions.add(req.uid, subscription, device);
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/web-push/subscription', middlewares, async (req, res) => {
		if (!req.uid) {
			return helpers.notAllowed(req, res);
		}

		const { subscription } = req.body;
		await subscriptions.remove(req.uid, subscription);
		helpers.formatApiResponse(200, res);
	});

	// Used by the service worker to close notifications that were already read elsewhere
	routeHelpers.setupApiRoute(router, 'get', '/web-push/unread-tags', middlewares, async (req, res) => {
		if (!req.uid) {
			return helpers.notAllowed(req, res);
		}

		helpers.formatApiResponse(200, res, {
			tags: await unread.getTags(req.uid),
		});
	});

	routeHelpers.setupApiRoute(router, 'post', '/web-push/test', middlewares, async (req, res) => {
		if (!req.uid) {
			return helpers.notAllowed(req, res);
		}

		const { userLang } = await user.getSettings(req.uid);
		const { subscription } = req.body;

		// Resolve the requested endpoint against the user's saved subscriptions
		// to prevent server-side request forgery via arbitrary endpoint injection.
		const endpoint = subscription?.endpoint?.trim();
		if (!endpoint) {
			return helpers.formatApiResponse(400, res);
		}

		const [owned, stored] = await Promise.all([
			db.isSortedSetMember(`uid:${req.uid}:web-push:subscriptions`, endpoint),
			db.getObject(`web-push:subscriptions:${endpoint}`),
		]);

		if (!owned || !stored) {
			return helpers.formatApiResponse(404, res);
		}

		const payload = await constructPayload({
			nid: utils.generateUUID(),
			bodyShort: '[[web-push:test.title]]',
			bodyLong: '[[web-push:test.body]]',
			path: `/me/web-push`,
		}, req.uid, userLang);

		// Guard against SSRF — validate the stored endpoint is not a reserved IP.
		const { ok } = await request.check(stored.endpoint);
		if (!ok) {
			return helpers.formatApiResponse(400, res);
		}

		try {
			await webPush.sendNotification(stored, JSON.stringify(payload));
		} catch (e) {
			await onSendError(req.uid, stored, e);
			return helpers.formatApiResponse(400, res, new Error('[[web-push:toast.test_unavailable]]'));
		}
		helpers.formatApiResponse(200, res);
	});
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/web-push',
		icon: 'fa-tint',
		name: '[[web-push:admin.menu-label]]',
	});

	return header;
};

plugin.onNotificationPush = async ({ notification, uidsNotified: uids }) => {
	const subs = await subscriptions.list(uids);
	uids = uids.filter(uid => subs.get(uid).size);
	const userSettings = await user.getMultipleUserSettings(uids);

	// Save recipients by nid (for use by .rescind)
	const refKey = `web-push:nid:${notification.mergeId || notification.nid}:uids`;
	await db.setAdd(refKey, uids);
	db.pexpire(refKey, 1000 * 60 * 60 * 48); // only track last 48 hours

	let payloads = await Promise.all(uids.map(async (uid, idx) => {
		const payload = await constructPayload(notification, uid, userSettings[idx].userLang);
		return [uid, payload];
	}));
	payloads = new Map(payloads);

	payloads.forEach((payload, uid) => {
		const targets = subs.get(uid);
		targets.forEach(async (subscription) => {
			try {
				await webPush.sendNotification(subscription, JSON.stringify(payload));
			} catch (e) {
				await onSendError(uid, subscription, e);
			}
		});
	});
};

plugin.onNotificationRescind = async ({ nids }) => {
	const notificationKeys = nids.map(nid => `notifications:${nid}`);
	let mergeIds = await db.getObjectsFields(notificationKeys, ['mergeId']);
	mergeIds = mergeIds.map(o => o.mergeId);

	// Favour mergeIds over nids, then eliminate dupes. The fallback must be the bare nid
	// (not the `notifications:<nid>` key), as that is the tag used in the push payload and
	// in the `web-push:nid:<tag>:uids` recipient set.
	const tags = new Set(nids.map((nid, i) => mergeIds[i] || nid));
	const recipients = await db.getSetsMembers(Array.from(tags).map(tag => `web-push:nid:${tag}:uids`));

	Promise.all(Array.from(tags).map(async (tag, idx) => {
		const subsByUid = await subscriptions.list(recipients[idx]);
		const targets = [];
		subsByUid.forEach((set, uid) => {
			set.forEach((subscription) => {
				if (!SILENT_PUSH_UNSUPPORTED.has(endpointHost(subscription))) {
					targets.push([uid, subscription]);
				}
			});
		});

		await Promise.all(targets.map(async ([uid, subscription]) => {
			try {
				await webPush.sendNotification(subscription, JSON.stringify({ tag }));
			} catch (e) {
				await onSendError(uid, subscription, e);
			}
		}));
	})).catch(err => winston.error(err.stack));
};

plugin.addProfileItem = (data) => {
	data.links.push({
		id: 'web-push',
		route: 'web-push',
		icon: 'fa-bell-o',
		name: '[[web-push:profile.label]]',
		visibility: {
			self: true,
			other: false,
			moderator: false,
			globalMod: false,
			admin: false,
			canViewInfo: false,
		},
	});

	return data;
};

async function constructPayload(notification, uid, lang) {
	let { maxLength, icon, badge } = await meta.settings.get('web-push');
	maxLength = parseInt(maxLength, 10) || 256;

	// i18n/rtl
	if (!lang) {
		lang = meta.config.defaultLang || 'en-GB';
	}
	const dir = await translator.translate('[[language:dir]]', lang);

	// Merge with related unread notifications
	if (notification.mergeId) {
		const related = await notifications.findRelated([notification.mergeId], `uid:${uid}:notifications:unread`);
		const merged = await notifications.getMultiple(related).then(notifications.merge);
		if (merged.length) {
			// Use the merged title (e.g. "3 new messages from …"), but keep the body and link of
			// the notification that triggered this push. The merged object is built from the first
			// notification in the set, so its bodyLong/path would otherwise always show the
			// first message instead of the newest one.
			const { bodyLong, path } = notification;
			notification = {
				...merged.pop(),
				...(bodyLong && { bodyLong }),
				...(path && { path }),
			};
		}
	}

	const { nid, mergeId, bodyShort, bodyLong, path } = notification;

	let [title, body] = await translator.translateKeys([bodyShort || '', bodyLong || ''], lang);
	([title, body] = [title, body].map(str => utils.stripHTMLTags(utils.decodeHTMLEntities(str))));
	title = `${dir === 'rtl' ? '\u200f' : '\u200e'}${title}`;
	const tag = mergeId || nid;
	const url = `${nconf.get('url')}${path}`;

	// Handle empty bodyLong
	if (!bodyLong) {
		body = title;
		title = meta.config.title || 'NodeBB';
	}

	// Truncate body if needed
	if (body.length > maxLength) {
		body = `${body.slice(0, maxLength)}…`;
	}

	icon = icon || `${nconf.get('url')}/apple-touch-icon`;
	if (!badge) { // badge fallbacks
		badge = `${nconf.get('url')}${meta.config['brand:maskableIcon'] || '/apple-touch-icon'}`;
	}

	const payload = {
		title,
		body,
		tag,
		lang,
		dir,
		data: { url, icon, badge },
	};

	// maxLength counts characters, but push services limit bytes, and non-Latin text takes two or
	// more bytes per character (a long Hebrew post failed with 413). Shorten the body, then the
	// title, until the whole payload fits.
	const size = () => Buffer.byteLength(JSON.stringify(payload));
	while (size() > MAX_PAYLOAD_BYTES && payload.body.length > 1) {
		const cut = Math.max(1, Math.ceil((size() - MAX_PAYLOAD_BYTES) / 2) + 1);
		payload.body = `${payload.body.slice(0, Math.max(0, payload.body.length - cut - 1))}…`;
	}
	while (size() > MAX_PAYLOAD_BYTES && payload.title.length > 1) {
		payload.title = `${payload.title.slice(0, Math.max(0, payload.title.length - 50))}…`;
	}
	return payload;
}
