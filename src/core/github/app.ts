import { retry } from "@octokit/plugin-retry";
import { App, Octokit } from "octokit";

if (
	!process.env.APP_ID ||
	!process.env.PRIVATE_KEY ||
	!process.env.WEBHOOK_SECRET
) {
	throw new Error("Missing required environment variables");
}

const OctokitWithRetry = Octokit.plugin(retry);

export const githubApp = new App({
	appId: process.env.APP_ID,
	privateKey: process.env.PRIVATE_KEY,
	webhooks: {
		secret: process.env.WEBHOOK_SECRET,
	},
	Octokit: OctokitWithRetry,
});
