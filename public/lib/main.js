// this file here as placeholder in case needed. Add back to plugin.json to use

'use strict';

(async () => {
	const [hooks, api] = await app.require(['hooks', 'api']);

	hooks.on('action:app.load', async () => {
		// ...
	});
})();
