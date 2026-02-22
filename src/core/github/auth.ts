import type { Octokit } from "octokit";
import { githubApp } from "./app";

export async function getInstallationOctokit(owner: string, repo: string) {
	const { data: installation } = await githubApp.octokit.request(
		"GET /repos/{owner}/{repo}/installation",
		{ owner, repo },
	);
	return githubApp.getInstallationOctokit(installation.id);
}

export async function getInstallationArtifacts(
	owner: string,
	repo: string,
): Promise<{
	octokit: Octokit;
	token: string;
}> {
	const octokit = await getInstallationOctokit(owner, repo);
	const { token } = (await octokit.auth({ type: "installation" })) as {
		token: string;
	};
	return { octokit, token };
}
