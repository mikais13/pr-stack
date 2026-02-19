import { githubApp } from "../app";

githubApp.webhooks.on("pull_request.closed", async ({ payload }) => {
	console.log(
		`PR #${payload.pull_request.number} was closed. Merged: ${payload.pull_request.merged}`,
	);
	await Promise.resolve();
});
