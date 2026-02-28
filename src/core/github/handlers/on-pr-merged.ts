import { traverseRebasedPRs } from "../../application/rebase";
import { githubApp } from "../app";

githubApp.webhooks.on("pull_request.closed", async ({ payload }) => {
	if (!payload.pull_request.merged) {
		return;
	}
	try {
		await traverseRebasedPRs({
			repository: payload.repository,
			pull_request: payload.pull_request,
		});
	} catch (error) {
		console.error(
			`Failed to rebase PRs after merging PR #${payload.pull_request.number} in ${payload.repository.full_name}:`,
			error,
		);
	}
});
