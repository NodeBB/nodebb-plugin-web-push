'use strict';

const db = nodebb.require('./src/database');

const Subscriptions = module.exports;

Subscriptions.count = async uid => await db.sortedSetCard(`uid:${uid}:web-push:subscriptions`);

Subscriptions.getUsers = async () => {
	const uids = await db.getSetMembers('web-push:uids');
	const counts = await db.sortedSetsCard(uids.map(uid => `uid:${uid}:web-push:subscriptions`));

	return new Map(uids.map((uid, idx) => [parseInt(uid, 10), counts[idx]]));
};

Subscriptions.list = async (uids) => {
	const endpoints = await db.getSortedSetsMembers(uids.map(uid => `uid:${uid}:web-push:subscriptions`));
	const response = new Map();
	await Promise.all(endpoints.map(async (eps, idx) => {
		const keys = eps.map(ep => `web-push:subscriptions:${ep}`);
		const data = await db.getObjects(keys);
		const subs = new Set();
		eps.forEach((ep, i) => {
			if (data[i]) {
				subs.add(data[i]);
			}
		});
		response.set(uids[idx], subs);
	}));

	return response;
};

Subscriptions.add = async (uid, subscription, device) => {
	const endpoint = subscription.endpoint;
	const entry = { ...subscription, ...(device || {}) };
	await Promise.all([
		db.sortedSetAdd(`uid:${uid}:web-push:subscriptions`, Date.now(), endpoint),
		db.setObject(`web-push:subscriptions:${endpoint}`, entry),
		db.setAdd('web-push:uids', uid),
	]);
};

Subscriptions.remove = async (uid, subscription) => {
	const endpoint = subscription.endpoint;
	await Promise.all([
		db.sortedSetRemove(`uid:${uid}:web-push:subscriptions`, endpoint),
		db.delete(`web-push:subscriptions:${endpoint}`),
	]);
	const count = await Subscriptions.count(uid);
	if (count < 1) {
		db.setRemove('web-push:uids', uid);
	}
};
