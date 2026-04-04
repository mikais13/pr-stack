import { Deque } from "@datastructures-js/deque";
import { $ } from "bun";
import type { Octokit } from "octokit";
import { getInstallationArtifacts } from "../github/auth";
import type { PullRequest } from "../models/pull-request.model";
import type { PullRequestData, RepositoryData } from "../schemas/shared.schema";
import { GitService } from "../services/git.service";
import { OctokitService } from "../services/octokit.service";

const REBASE_OPT_IN_LABEL = "pr-stack:auto-rebase";

type WorkItem = {
	sourceRef: string;
	sourceRefSHA: string;
	rebaseOnto: string;
};

export async function cascadeRebase(
	queue: Deque<WorkItem>,
	gitService: GitService,
	githubService: OctokitService,
	octokit: Octokit,
	owner: string,
	repo: string,
): Promise<void> {
	const failures: { pr: PullRequest; error: unknown }[] = [];

	while (queue.size() > 0) {
		const workItem = queue.popFront();
		if (!workItem) {
			break;
		}
		const { sourceRef, sourceRefSHA, rebaseOnto } = workItem;

		console.log(`[rebase] Fetching open PRs based on "${sourceRef}"`);
		const dependentPRs = await githubService.getPullRequestsByBase(
			sourceRef,
			"open",
		);
		console.log(
			`[rebase] Found ${dependentPRs.length} PR(s) with base "${sourceRef}":`,
			dependentPRs.map((pr) => `#${pr.getNumber()} (${pr.getHead()})`),
		);

		const eligiblePRs = dependentPRs.filter((pr) =>
			pr.getLabels().includes(REBASE_OPT_IN_LABEL),
		);
		const skipped = dependentPRs.length - eligiblePRs.length;
		if (skipped > 0) {
			console.log(
				`[rebase] Skipping ${skipped} PR(s) without "${REBASE_OPT_IN_LABEL}" label`,
			);
		}

		for (const pr of eligiblePRs) {
			console.log(
				`[rebase] Rebasing PR #${pr.getNumber()} (${pr.getHead()} onto ${rebaseOnto})`,
			);
			const oldPRHeadSHA = await gitService.fetchAndGetSHA(pr.getHead());
			try {
				await rebase(
					gitService,
					octokit,
					owner,
					repo,
					pr,
					rebaseOnto,
					sourceRefSHA,
				);
			} catch (error) {
				console.error(
					`[rebase] PR #${pr.getNumber()} (${pr.getHead()}) FAILED — skipping its dependents. Error:`,
					error,
				);
				failures.push({ pr, error });
				continue;
			}

			console.log(
				`[rebase] PR #${pr.getNumber()} done — base updated to "${rebaseOnto}"`,
			);
			queue.pushBack({
				sourceRef: pr.getHead(),
				sourceRefSHA: oldPRHeadSHA,
				rebaseOnto: pr.getHead(),
			});
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`[rebase] ${failures.length} PR(s) failed: ` +
				failures
					.map((f) => `#${f.pr.getNumber()} (${f.pr.getHead()})`)
					.join(", "),
		);
	}
}

export async function startRebases({
	repository: {
		owner: { login: owner },
		name: repo,
		full_name: fullName,
	},
	pull_request: { head, base },
}: {
	repository: RepositoryData;
	pull_request: PullRequestData;
}): Promise<void> {
	console.log(
		`[rebase] Starting rebase for ${fullName} — merged PR head=${head.ref} (${head.sha}) base=${base.ref} (${base.sha})`,
	);

	const { octokit, token } = await getInstallationArtifacts(owner, repo);
	console.log(`[rebase] Got installation artifacts for ${owner}/${repo}`);

	const githubService = new OctokitService(octokit, owner, repo);
	const clonePath = `/tmp/rebase-${head.sha}`;
	const gitService = new GitService(clonePath, token);

	console.log(`[rebase] Cloning ${fullName}`);
	await gitService.cloneRepo(`https://github.com/${fullName}.git`, {
		bare: false,
	});
	console.log(`[rebase] Clone complete`);

	try {
		const queue = new Deque<WorkItem>([
			{
				sourceRef: head.ref,
				sourceRefSHA: head.sha,
				rebaseOnto: base.ref,
			},
		]);
		await cascadeRebase(queue, gitService, githubService, octokit, owner, repo);
		console.log(`[rebase] All done`);
	} finally {
		await $`rm -rf ${clonePath}`;
	}
}

async function rebase(
	gitService: GitService,
	octokit: Octokit,
	owner: string,
	repo: string,
	pr: PullRequest,
	rebaseOnto: string,
	upstreamSHA: string,
): Promise<void> {
	// Step 1: local rebase (throws on unresolvable conflict — no remote changes yet)
	await localRebase(gitService, pr.getHead(), rebaseOnto, upstreamSHA);
	console.log(`[rebase] Rebase complete for PR #${pr.getNumber()}, pushing`);

	// Step 2: push — if this throws, remote is unchanged
	try {
		await gitService.push(pr.getHead(), { forceWithLease: true });
	} catch (error) {
		throw new Error(
			`[rebase] PR #${pr.getNumber()}: git push failed — ` +
				`branch "${pr.getHead()}" was rebased locally but NOT pushed to remote. ` +
				`Remote is unchanged. Cause: ${error}`,
		);
	}
	console.log(`[rebase] Push complete, updating base branch on GitHub`);

	// Step 3: GitHub metadata update — if this throws, branch IS already pushed
	try {
		await octokit.rest.pulls.update({
			owner,
			repo,
			pull_number: pr.getNumber(),
			base: rebaseOnto,
			state: "open",
		});
	} catch (error) {
		throw new Error(
			`[rebase] PR #${pr.getNumber()}: GitHub base update FAILED after successful push. ` +
				`Branch "${pr.getHead()}" is now on new history but PR base still shows "${pr.getBase()}". ` +
				`Manual update of the PR base to "${rebaseOnto}" is required. Cause: ${error}`,
		);
	}
}

function extractConflictingFiles(errorMessage: string): string[] {
	const files: string[] = [];
	for (const line of errorMessage.split("\n")) {
		if (!line.includes("CONFLICT")) continue;

		// "CONFLICT (content|add/add): Merge conflict in <path>"
		const mergeConflictMatch = line.match(/Merge conflict in (.+)$/);
		if (mergeConflictMatch?.[1]) {
			files.push(mergeConflictMatch[1].trim());
			continue;
		}

		// "CONFLICT (modify/delete): <path> deleted in ..."
		const tokenMatch = line.match(/CONFLICT \([^)]+\): (\S+)/);
		if (tokenMatch?.[1]) {
			files.push(tokenMatch[1]);
		}
	}
	return files;
}

async function localRebase(
	gitService: GitService,
	branchRef: string,
	newBase: string,
	upstreamSHA: string,
) {
	console.log(`[performRebase] Rebasing "${branchRef}" onto "${newBase}"`);
	try {
		await gitService.rebase(branchRef, newBase, upstreamSHA);
		console.log(`[performRebase] Clean rebase — no conflicts`);
	} catch (error) {
		if (!(error instanceof $.ShellError)) throw error;
		await gitService.abortRebase();
		const conflictingFiles = extractConflictingFiles(
			error.stderr.toString() ?? error.message,
		);
		throw new Error(
			`Conflict in ${conflictingFiles.length} file(s) — manual resolution required: ${conflictingFiles.join(", ")}`,
		);
	}
}
