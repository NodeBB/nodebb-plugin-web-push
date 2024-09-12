<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="web-push-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Settings</h5>

					<p class="fst-italic">
						There are no settings to adjust for this plugin — at this time.
					</p>
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
								{buildAvatar(users, "24px", false)}
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
