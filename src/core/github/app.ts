import { App } from "octokit";

if (
	!process.env.APP_ID ||
	!process.env.PRIVATE_KEY ||
	!process.env.WEBHOOK_SECRET
) {
	throw new Error("Missing required environment variables");
}

export const githubApp = new App({
	appId: process.env.APP_ID,
	privateKey: process.env.PRIVATE_KEY,
	webhooks: {
		secret: process.env.WEBHOOK_SECRET,
	},
});
