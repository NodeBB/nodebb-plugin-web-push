/**
 * You can run these tests by executing `npx mocha test/plugins-installed.js`
 * from the NodeBB root folder. The regular test runner will also run these
 * tests.
 *
 * Keep in mind tests do not activate all plugins, so if you are testing
 * hook listeners, socket.io, or mounted routes, you will need to add your
 * plugin to `config.json`, e.g.
 *
 * {
 *     "test_plugins": [
 *         "nodebb-plugin-web-push"
 *     ]
 * }
 */

'use strict';

/* globals describe, it, before */

const assert = require('assert');

const db = nodebb.require('./test/mocks/databasemock');
const user = nodebb.require('./src/user');

const Subscriptions = require('../lib/subscriptions');

describe('nodebb-plugin-web-push', () => {
	let uid1, uid2;

	before(async () => {
		uid1 = await user.create({ username: 'pushuser1' });
		uid2 = await user.create({ username: 'pushuser2' });
	});

	describe('Subscriptions.isValidEndpoint', () => {
		it('should reject non-https endpoints', async () => {
			assert.equal(await Subscriptions.isValidEndpoint('http://example.com/push'), false);
			assert.equal(await Subscriptions.isValidEndpoint('ftp://example.com/push'), false);
		});

		it('should reject malformed URLs', async () => {
			assert.equal(await Subscriptions.isValidEndpoint('not-a-url'), false);
			assert.equal(await Subscriptions.isValidEndpoint(''), false);
		});

		it('should accept valid https endpoints', async () => {
			const ok = await Subscriptions.isValidEndpoint('https://fcm.googleapis.com/fcm/send/abc123');
			assert.ok(ok, 'should accept valid https endpoint');
		});
	});

	describe('Subscriptions.add', () => {
		it('should add a valid subscription for a user', async () => {
			const subscription = {
				endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-1',
				keys: {
					auth: 'auth-key',
					p256dh: 'p256dh-key',
				},
			};
			await Subscriptions.add(uid1, subscription, { browser: 'chrome' });

			const inSet = await db.isSortedSetMember(`uid:${uid1}:web-push:subscriptions`, subscription.endpoint);
			assert.ok(inSet, 'endpoint should be in user\'s sorted set');

			const entry = await db.getObject(`web-push:subscriptions:${subscription.endpoint}`);
			assert.ok(entry, 'subscription object should exist');
			assert.equal(entry.browser, 'chrome');
			assert.equal(entry.uid, uid1);
		});

		it('should reject non-https endpoints', async () => {
			try {
				await Subscriptions.add(uid1, {
					endpoint: 'http://192.168.1.1/push',
				});
				assert.fail('should have thrown');
			} catch (e) {
				assert.equal(e.message, '[[error:invalid-url]]');
			}
		});

		it('should not overwrite another user\'s subscription record', async () => {
			const existingEndpoint = 'https://fcm.googleapis.com/fcm/send/test-device-1';
			const subscription = {
				endpoint: existingEndpoint,
				keys: {
					auth: 'auth-key-2',
					p256dh: 'p256dh-key-2',
				},
			};

			try {
				await Subscriptions.add(uid2, subscription);
				assert.fail('should have thrown for ownership conflict');
			} catch (e) {
				assert.equal(e.message, '[[error:invalid-url]]');
			}

			const entry = await db.getObject(`web-push:subscriptions:${existingEndpoint}`);
			assert.ok(entry, 'uid1\'s subscription entry should still exist');
			assert.equal(entry.browser, 'chrome');
			assert.equal(entry.uid, uid1);
		});
	});

	describe('Subscriptions.remove', () => {
		it('should not delete another user\'s global subscription record', async () => {
			const subscription1 = {
				endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-a',
				keys: {
					auth: 'auth-a',
					p256dh: 'p256dh-a',
				},
			};
			await Subscriptions.add(uid1, subscription1);

			// uid2 tries to remove uid1's subscription by knowing the endpoint
			await Subscriptions.remove(uid2, subscription1);

			const entry = await db.getObject(`web-push:subscriptions:${subscription1.endpoint}`);
			assert.ok(entry, 'uid1\'s subscription should still exist after uid2\'s remove attempt');

			const inSet = await db.isSortedSetMember(`uid:${uid1}:web-push:subscriptions`, subscription1.endpoint);
			assert.ok(inSet, 'uid1\'s endpoint should still be in their sorted set');
		});

		it('should successfully remove own subscription', async () => {
			const subscription = {
				endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-b',
				keys: {
					auth: 'auth-b',
					p256dh: 'p256dh-b',
				},
			};
			await Subscriptions.add(uid2, subscription);

			await Subscriptions.remove(uid2, subscription);

			const inSet = await db.isSortedSetMember(`uid:${uid2}:web-push:subscriptions`, subscription.endpoint);
			assert.equal(inSet, false, 'endpoint should be removed from sorted set');

			const entry = await db.getObject(`web-push:subscriptions:${subscription.endpoint}`);
			assert.equal(entry, null, 'global subscription object should be deleted');
		});

		it('should be a no-op when the endpoint is not in the user\'s set', async () => {
			const subscription = {
				endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-1',
			};
			await Subscriptions.remove(uid2, subscription);

			const entry = await db.getObject(`web-push:subscriptions:${subscription.endpoint}`);
			assert.ok(entry, 'uid1\'s record should be untouched');
		});
	});

	describe('Subscriptions.list', () => {
		it('should return only the user\'s own subscriptions', async () => {
			const result = await Subscriptions.list([uid1, uid2]);

			const uid1Subs = result.get(uid1);
			assert.ok(uid1Subs.size > 0, 'uid1 should have subscriptions');

			const uid2Subs = result.get(uid2);
			const hasDeviceB = Array.from(uid2Subs).some(s => s.endpoint === 'https://fcm.googleapis.com/fcm/send/test-device-b');
			assert.equal(hasDeviceB, false, 'uid2\'s removed subscription should not appear');
		});
	});
});
