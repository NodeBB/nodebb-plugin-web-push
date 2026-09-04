'use strict';

const db = nodebb.require('./src/database');
const request = nodebb.require('./src/request');

const Subscriptions = module.exports;

// The endpoint is caller-supplied and is later POSTed to by the server on every
// notification, so it has to be checked before it is persisted.
Subscriptions.isValidEndpoint = async (endpoint) => {
	let url;
	try {
		url = new URL(endpoint);
	} catch (e) {
		return false;
	}

	if (url.protocol !== 'https:') {
		return false;
	}

	try {
		const { ok } = await request.check(url.href);
		return ok;
	} catch (e) {
		return false;
	}
};

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
	const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';
	if (!await Subscriptions.isValidEndpoint(endpoint)) {
		throw new Error('[[error:invalid-url]]');
	}

	// Ownership check — the global key must not be claimed by another user.
	// (Web Push endpoints are unique per subscription, so sharing a key between
	// users is not a valid scenario.)
	const existingUid = await db.getObjectField(`web-push:subscriptions:${endpoint}`, 'uid');
	if (existingUid && parseInt(existingUid, 10) !== uid) {
		throw new Error('[[error:invalid-url]]');
	}

	const entry = { ...subscription, ...(device || {}), endpoint, uid };
	await Promise.all([
		db.sortedSetAdd(`uid:${uid}:web-push:subscriptions`, Date.now(), endpoint),
		db.setObject(`web-push:subscriptions:${endpoint}`, entry),
		db.setAdd('web-push:uids', uid),
	]);
};

Subscriptions.remove = async (uid, subscription) => {
	const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';

	// Ownership check — only the user who registered this endpoint can delete it.
	const owned = await db.isSortedSetMember(`uid:${uid}:web-push:subscriptions`, endpoint);
	if (!owned) {
		return;
	}

	await Promise.all([
		db.sortedSetRemove(`uid:${uid}:web-push:subscriptions`, endpoint),
		db.delete(`web-push:subscriptions:${endpoint}`),
	]);
	const count = await Subscriptions.count(uid);
	if (count < 1) {
		await db.setRemove('web-push:uids', uid);
	}
};
