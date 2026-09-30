'use strict';

const db = nodebb.require('./src/database');

const Unread = module.exports;

/**
 * Returns the notification tags (mergeId, falling back to nid — the same value used as
 * the `tag` of every push payload) of a user's unread notifications.
 *
 * The service worker compares these against the notifications it is currently showing and
 * closes the ones that are no longer unread (i.e. were read on another device).
 */
Unread.getTags = async (uid) => {
	if (!(parseInt(uid, 10) > 0)) {
		return [];
	}

	const nids = await db.getSortedSetRevRange(`uid:${uid}:notifications:unread`, 0, -1);
	if (!nids.length) {
		return [];
	}

	const data = await db.getObjectsFields(nids.map(nid => `notifications:${nid}`), ['mergeId']);
	return Array.from(new Set(nids.map((nid, idx) => String((data[idx] && data[idx].mergeId) || nid))));
};
