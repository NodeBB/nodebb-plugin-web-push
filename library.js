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

		const { subscription } = req.body;
		await webPush.sendNotification(subscription, JSON.stringify({
			title: 'Test notification',
			body: 'This is a test message sent from NodeBB',
			data: {
				url: `${nconf.get('url')}/me/web-push`,
			},
		}));
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
		const payload = await constructPayload(notification, userSettings[idx].userLang);
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
			subs.forEach(async (subscription) => {
				await webPush.sendNotification(subscription, JSON.stringify({ tag }));
			});
		}
	}));
};

plugin.addProfileItem = async (data) => {
	const title = await translator.translate('[[web-push:profile.label]]');
	data.links.push({
		id: 'web-push',
		route: 'web-push',
		icon: 'fa-bell-o',
		name: title,
		visibility: {
			self: true,
			other: false,
			moderator: false,
			globalMod: false,
			admin: false,
		},
	});

	return data;
};

async function constructPayload({ nid, mergeId, bodyShort, bodyLong, path }, language) {
	let { maxLength } = await meta.settings.get('web-push');
	maxLength = parseInt(maxLength, 10) || 256;

	if (!language) {
		language = meta.config.defaultLang || 'en-GB';
	}

	let [title, body] = await translator.translateKeys([bodyShort, bodyLong], language);
	([title, body] = [title, body].map(str => validator.unescape(utils.stripHTMLTags(str))));
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

	return {
		title,
		body,
		tag,
		data: { url },
	};
}

module.exports = plugin;
