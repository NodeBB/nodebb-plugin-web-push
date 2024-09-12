'use strict';

const db = require.main.require('./src/database');

const Subscriptions = module.exports;

Subscriptions.count = async uid => await db.sortedSetCard(`uid:${uid}:web-push:subscriptions`);

Subscriptions.getUsers = async () => {
	const uids = await db.getSetMembers('web-push:uids');
	const counts = await db.sortedSetsCard(uids.map(uid => `uid:${uid}:web-push:subscriptions`));

	return new Map(uids.map((uid, idx) => [parseInt(uid, 10), counts[idx]]));
};

Subscriptions.list = async (uids) => {
	const subscriptions = await db.getSortedSetsMembers(uids.map(uid => `uid:${uid}:web-push:subscriptions`));
	const response = new Map();
	subscriptions.forEach((subscriptions, idx) => {
		response.set(uids[idx], new Set(subscriptions.map(sub => JSON.parse(sub))));
	});

	return response;
};

Subscriptions.add = async (uid, subscription) => {
	await Promise.all([
		db.sortedSetAdd(`uid:${uid}:web-push:subscriptions`, Date.now(), JSON.stringify(subscription)),
		db.setAdd('web-push:uids', uid),
	]);
};

Subscriptions.remove = async (uid, subscription) => {
	await db.sortedSetRemove(`uid:${uid}:web-push:subscriptions`, JSON.stringify(subscription));
	const count = await Subscriptions.count(uid);
	if (count < 1) {
		db.setRemove('web-push:uids', uid);
	}
};
