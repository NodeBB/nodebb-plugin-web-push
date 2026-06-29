<!-- IMPORT partials/account/header.tpl -->

<h3 class="fw-semibold fs-5">[[web-push:profile.label]]</h3>

<p>[[web-push:profile.introduction]]</p>

<div class="alert alert-warning d-none" id="permission-warning">[[web-push:profile.permissionBlocked]]</div>

<form role="form" component="web-push-form">
	<div class="form-check form-switch mb-3">
		<input type="checkbox" class="form-check-input" id="enabled" name="enabled" autocomplete="off" data-action="toggle">
		<label for="enabled" class="form-check-label">[[web-push:profile.option]]</label>
	</div>
	<div class="mb-3">
		<button type="button" class="btn btn-primary" data-action="test">[[web-push:profile.send-test]]</button>
	</div>
	<div id="deviceList">
		{{{ if devices.length }}}
		<div class="table-responsive">
			<table class="table table-sm">
				<thead>
					<tr>
						<th>[[web-push:profile.device]]</th>
						<th>[[web-push:profile.browser]]</th>
						<th>[[web-push:profile.os]]</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{{{ each devices }}}
					<tr>
						<td>
							{{{ if ./platform }}}
							{./platform}
							{{{ else }}}
							[[web-push:profile.unknown]]
							{{{ end }}}
						</td>
						<td>
							{{{ if ./browser }}}
							{./browser}
							{{{ else }}}
							[[web-push:profile.unknown]]
							{{{ end }}}
						</td>
						<td>
							{{{ if ./os }}}
							{./os}
							{{{ else }}}
							[[web-push:profile.unknown]]
							{{{ end }}}
						</td>
						<td>
							<button type="button" class="btn btn-sm btn-link text-danger" data-action="remove" data-endpoint="{./endpoint}" aria-label="[[web-push:profile.remove]]"><i class="fa fa-trash"></i></button>
						</td>
					</tr>
					{{{ end }}}
				</tbody>
			</table>
		</div>
		{{{ else }}}
		<p class="text-muted">[[web-push:profile.no-devices]]</p>
		{{{ end }}}
	</div>
</form>

<!-- IMPORT partials/account/footer.tpl -->