import { githubApp } from "./app";

export async function getInstallationToken(
	owner: string,
	repo: string,
): Promise<string> {
	const { data: installation } = await githubApp.octokit.request(
		"GET /repos/{owner}/{repo}/installation",
		{ owner, repo },
	);
	const octokit = await githubApp.getInstallationOctokit(installation.id);
	const { token } = (await octokit.auth({ type: "installation" })) as {
		token: string;
	};
	return token;
}
