'use strict';

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const webPush = require('web-push');
const validator = require('validator');

const db = require.main.require('./src/database');
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const utils = require.main.require('./src/utils');
const translator = require.main.require('./src/translator');
const notifications = require.main.require('./src/notifications');

const controllers = require('./lib/controllers');
const subscriptions = require('./lib/subscriptions');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};

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
	scripts.add(`nodebb-plugin-web-push/static/web-push.js`);
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
		await subscriptions.add(req.uid, subscription);
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

	routeHelpers.setupApiRoute(router, 'post', '/web-push/test', middlewares, async (req, res) => {
		if (!req.uid) {
			return helpers.notAllowed(req, res);
		}

		const { userLang } = await user.getSettings(req.uid);
		const { subscription } = req.body;
		const payload = await constructPayload({
			nid: utils.generateUUID(),
			bodyShort: 'Test notification',
			bodyLong: 'This is a test message sent from NodeBB',
			path: `/me/web-push`,
		}, req.uid, userLang);
		await webPush.sendNotification(subscription, JSON.stringify(payload));
	});
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/web-push',
		icon: 'fa-tint',
		name: 'Push Notifications (via Push API)',
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
				// Errored — remove subscription from user
				winston.info(`[plugins/web-push] Push failed: ${e.code}; ${e.message}; statusCode: ${e.statusCode}`);
				// subscriptions.remove(uid, subscription);
			}
		});
	});
};

plugin.onNotificationRescind = async ({ nids }) => {
	const notificationKeys = nids.map(nid => `notifications:${nid}`);
	let mergeIds = await db.getObjectsFields(notificationKeys, ['mergeId']);
	mergeIds = mergeIds.map(o => o.mergeId);

	// Favour mergeIds over nids, then eliminate dupes
	const tags = new Set(notificationKeys.map((key, i) => mergeIds[i] || key));
	const recipients = await db.getSetsMembers(Array.from(tags).map(tag => `web-push:nid:${tag}:uids`));

	Promise.all(Array.from(tags).map(async (tag, idx) => {
		let subs = await subscriptions.list(recipients[idx]);
		subs = new Set(...Object.values(Object.fromEntries(subs))); // wtf

		if (subs.size) {
			await Promise.all(Array.from(subs).map(async (subscription) => {
				try {
					await webPush.sendNotification(subscription, JSON.stringify({ tag }));
				} catch (e) {
					winston.info(`[plugins/web-push] Push failed: ${e.code}; ${e.message}; statusCode: ${e.statusCode}`);
				}
			}));
		}
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
			notification = merged.pop();
		}
	}

	const { nid, mergeId, bodyShort, bodyLong, path } = notification;

	let [title, body] = await translator.translateKeys([bodyShort, bodyLong], lang);
	([title, body] = [title, body].map(str => validator.unescape(utils.stripHTMLTags(str))));
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

	return {
		title,
		body,
		tag,
		lang,
		dir,
		data: { url, icon, badge, mergeId },
	};
}

module.exports = plugin;
