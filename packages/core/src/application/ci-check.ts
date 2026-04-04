import { $ } from "bun";
import { getInstallationArtifacts } from "../github/auth";
import type { CiCheckParams } from "../schemas/ci-check.schema";
import { GitService } from "../services/git.service";
import { OctokitService } from "../services/octokit.service";

export async function shouldSkipCI({
	before,
	after,
	repository,
	pull_request: { head, base },
}: CiCheckParams) {
	if (after !== head.sha) {
		return {
			skipCI: false,
			message: `After SHA ${after} does not match head SHA ${head.sha}`,
		};
	}

	const {
		owner: { login: owner },
		name: repo,
		full_name,
	} = repository;
	const { octokit, token } = await getInstallationArtifacts(owner, repo);

	const githubService = new OctokitService(octokit, owner, repo);
	const clonePath = `/tmp/ci-check-${after}`;
	const gitService = new GitService(clonePath, token);

	const [beforeCommit, afterCommit] = await Promise.all([
		githubService.getCommit(before),
		githubService.getCommit(after),
	]);

	if (!beforeCommit || !afterCommit) {
		return {
			skipCI: false,
			message: `Could not retrieve commits for before SHA ${before} or after SHA ${after}`,
		};
	}

	const beforeTreeSHA = beforeCommit.getTreeSHA();
	const afterTreeSHA = afterCommit.getTreeSHA();

	try {
		await gitService.cloneRepo(`https://github.com/${full_name}.git`, {
			bare: true,
		});
	} catch {
		return {
			skipCI: false,
			message: `Failed to clone repository ${full_name}`,
		};
	}

	try {
		const currentBranchCommits = await gitService.traverseToSHA(
			head.sha,
			base.sha,
		);
		if (!currentBranchCommits) {
			return {
				skipCI: false,
				message: `Failed to traverse commits from head SHA ${head.sha} to base SHA ${base.sha}`,
			};
		}

		// if the previous head SHA is an ancestor of the current head, then additional commits have been added
		// this would be picked up by tips having different tree SHAs, but this is a more direct check for a better message
		if (currentBranchCommits.some((commit) => commit.getSHA() === before)) {
			return {
				skipCI: false,
				message: `Before SHA ${before} is an ancestor of head SHA ${head.sha}`,
			};
		}

		// if tree shas at head are different, then this is minimal requirement for real changes to have occurred
		if (beforeTreeSHA !== afterTreeSHA) {
			return {
				skipCI: false,
				message: `Before commit tree SHA ${beforeTreeSHA} does not match after commit tree SHA ${afterTreeSHA}`,
			};
		}

		return {
			skipCI: true,
			message: "No changes detected between before and after commits",
		};
	} finally {
		await $`rm -rf ${clonePath}`;
	}
}
