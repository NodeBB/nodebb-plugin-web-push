'use strict';

const db = nodebb.require('./src/database');
const batch = nodebb.require('./src/batch');

module.exports = {
	name: 'Migrate_web_push_subscriptions_to_endpoint_keys',
	timestamp: Date.UTC(2025, 5, 29),
	method: async () => {
		const uids = await db.getSetMembers('web-push:uids');
		if (!uids.length) {
			return;
		}

		await batch.processArray(uids, async (uidBatch) => {
			const keys = uidBatch.map(uid => `uid:${uid}:web-push:subscriptions`);
			const entries = await db.getSortedSetsMembersWithScores(keys);

			for (let i = 0; i < uidBatch.length; i++) {
				const uid = uidBatch[i];
				const results = entries[i] || [];
				if (!results.length) {
					continue;
				}

				const scores = [];
				const endpoints = [];

				for (const { value, score } of results) {
					try {
						const data = JSON.parse(value);
						const endpoint = data.endpoint;
						if (!endpoint) {
							continue;
						}

						await db.setObject(`web-push:subscriptions:${endpoint}`, data);
						scores.push(score);
						endpoints.push(endpoint);
					} catch {
						// Skip unparseable entries
					}
				}

				if (endpoints.length) {
					await db.delete(`uid:${uid}:web-push:subscriptions`);
					await db.sortedSetAdd(`uid:${uid}:web-push:subscriptions`, scores, endpoints);
				} else {
					await db.delete(`uid:${uid}:web-push:subscriptions`);
				}
			}
		}, {
			batch: 50,
			interval: 100,
		});
	},
};
