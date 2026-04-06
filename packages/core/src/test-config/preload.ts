import { mock } from "bun:test";

// Mock app.ts globally as it throws at eval time when env vars are missing,
// so it must be intercepted here before any test file imports it.
mock.module("../github/app", () => ({
	githubApp: {
		webhooks: { on: () => {} },
		octokit: { request: async () => ({}) },
		getInstallationOctokit: async () => ({}),
	},
}));
