<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="web-push-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("web-push:admin.settings")}}</h5>

					<div class="mb-3">
						<label class="form-label" for="maxLength">{{tx("web-push:admin.max-length")}}</label>
						<input type="number" min="0" max="4096" id="maxLength" name="maxLength" title="{{tx("web-push:admin.max-length")}}" class="form-control" placeholder="256">
						<p class="form-text">{{tx("web-push:admin.max-length-help")}}</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="badge">{{tx("web-push:admin.badge")}}</label>
						<input type="text" id="badge" name="badge" title="{{tx("web-push:admin.badge")}}" class="form-control" placeholder="https://...">
						<p class="form-text">{{tx("web-push:admin.badge-help")}}</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="icon">{{tx("web-push:admin.icon")}}</label>
						<input type="text" id="icon" name="icon" title="{{tx("web-push:admin.icon")}}" class="form-control" placeholder="https://...">
						<p class="form-text">{{tx("web-push:admin.icon-help")}}</p>
					</div>
				</div>
			</form>

			<div class="mb-4">
				<h5 class="fw-bold tracking-tight settings-header">{{tx("web-push:admin.users")}}</h5>
				<table class="table">
					<thead>
						<tr>
							<th>{{tx("web-push:admin.user")}}</th>
							<th>{{tx("web-push:admin.devices")}}</th>
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
