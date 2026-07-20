<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="web-push-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Settings</h5>

					<div class="mb-3">
						<label class="form-label" for="maxLength">Maximum length</label>
						<input type="number" min="0" max="4096" id="maxLength" name="maxLength" title="Maximum message length" class="form-control" placeholder="256">
						<p class="form-text">
							Additional characters beyond this specified length will be truncated.
							Due to a software limitation, if the message body is greater than 4096 bytes, the message itself will be an attachment in the push notification.
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="badge">Badge URL</label>
						<input type="text" id="badge" name="badge" title="Badge" class="form-control" placeholder="https://...">
						<p class="form-text">
							Optional — overrides the badge for messages sent (usually seen in the notification bar on mobile devices)
							By default, the site's configured "touch icon" is sent.
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="icon">Icon URL</label>
						<input type="text" id="icon" name="icon" title="Icon" class="form-control" placeholder="https://...">
						<p class="form-text">
							Optional — overrides the icon for messages sent (can be used for branding, etc.)
							By default, the site's configured "touch icon" is sent.
						</p>
					</div>
				</div>
			</form>

			<div class="mb-4">
				<h5 class="fw-bold tracking-tight settings-header">Users</h5>
				<table class="table">
					<thead>
						<tr>
							<th>User</th>
							<th>Devices</th>
						</tr>
					</thead>
					<tbody>
						{{{ each users }}}
						<tr>
							<td>
								{{buildAvatar(users, "24px", false)}}
								{./username}
							</td>
							<td>{./deviceCount}</td>
						</tr>
						{{{ end }}}
					</tbody>
				</table>
			</div>
		</div>

		<!-- IMPORT admin/partials/settings/toc.tpl -->
	</div>
</div>
