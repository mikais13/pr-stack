import { $ } from "bun";
import type {
	PullRequestData,
	RepositoryData,
} from "../../api/schemas/shared.schema";
import { getInstallationArtifacts } from "../github/auth";
import type { Commit } from "../models/commit.model";
import { GitService } from "../services/git.service";
import { OctokitService } from "./../services/octokit.service";

export async function rebase({
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

	console.log(`[rebase] Fetching open PRs based on "${head.ref}"`);
	const pullRequestsToRebase = await githubService.getPullRequestsByBase(
		head.ref,
		"open",
	);
	console.log(
		`[rebase] Found ${pullRequestsToRebase.length} PR(s) to rebase:`,
		pullRequestsToRebase.map((pr) => `#${pr.getNumber()} (${pr.getHead()})`),
	);

	console.log(`[rebase] Cloning ${fullName}`);
	await gitService.cloneRepo(`https://github.com/${fullName}.git`, {
		bare: false,
	});
	console.log(`[rebase] Clone complete`);

	try {
		console.log(`[rebase] Traversing commits from ${head.sha} to ${base.sha}`);
		const commitsIntroducedByPR = await gitService.traverseToSHA(
			head.sha,
			base.sha,
		);
		if (!commitsIntroducedByPR) {
			throw new Error(
				`Failed to traverse commits from head SHA ${head.sha} to base SHA ${base.sha}`,
			);
		}
		console.log(
			`[rebase] Found ${commitsIntroducedByPR.length} commit(s) introduced by merged PR`,
		);

		for (const pr of pullRequestsToRebase) {
			console.log(
				`[rebase] Rebasing PR #${pr.getNumber()} (${pr.getHead()} onto ${base.ref})`,
			);
			await performRebase(
				gitService,
				pr.getHead(),
				base.ref,
				commitsIntroducedByPR,
			);
			console.log(
				`[rebase] Rebase complete for PR #${pr.getNumber()}, pushing`,
			);
			await gitService.push(pr.getHead(), { forceWithLease: true });
			console.log(`[rebase] Push complete, updating base branch on GitHub`);
			await octokit.rest.pulls.update({
				owner,
				repo,
				pull_number: pr.getNumber(),
				base: base.ref,
			});
			console.log(
				`[rebase] PR #${pr.getNumber()} done — base updated to "${base.ref}"`,
			);
		}

		console.log(`[rebase] All done`);
	} finally {
		await $`rm -rf ${clonePath}`;
	}
}

function extractConflictingFiles(errorMessage: string): string[] {
	const files: string[] = [];
	for (const line of errorMessage.split("\n")) {
		if (!line.includes("CONFLICT")) continue;

		// "CONFLICT (content|add/add): Merge conflict in <path>"
		const mergeConflictMatch = line.match(/Merge conflict in (.+)$/);
		if (mergeConflictMatch) {
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

async function performRebase(
	gitService: GitService,
	branchRef: string,
	newBase: string,
	commitsIntroducedByPR: Commit[],
) {
	console.log(`[performRebase] Rebasing "${branchRef}" onto "${newBase}"`);
	try {
		await gitService.rebase(branchRef, newBase);
		console.log(`[performRebase] Clean rebase — no conflicts`);
	} catch (error) {
		if (!(error instanceof $.ShellError)) {
			throw error;
		}
		const errorMessage = error.stderr.toString() ?? error.message;
		const conflictingFiles = extractConflictingFiles(errorMessage);
		console.log(
			`[performRebase] Rebase hit conflicts in ${conflictingFiles.length} file(s):`,
			conflictingFiles,
		);

		const fileToConflictsMap: Record<string, { start: number; end: number }[]> =
			{};
		for (const file of conflictingFiles) {
			const fileContent = await $`cat ${file}`
				.cwd(gitService.getRepoPath())
				.text();
			const lines = fileContent.split("\n");
			const conflictPositions: { start: number; end: number }[] = [];

			let lineNumber = 0;
			let currentStart = 0;
			let inIncomingSection = false;

			for (const line of lines) {
				if (line.startsWith("<<<<<<<")) {
					currentStart = lineNumber + 1;
				} else if (line.startsWith("=======")) {
					conflictPositions.push({ start: currentStart, end: lineNumber });
					inIncomingSection = true;
				} else if (line.startsWith(">>>>>>>")) {
					inIncomingSection = false;
				} else if (!inIncomingSection) {
					lineNumber++;
				}
			}
			fileToConflictsMap[file] = conflictPositions;
			console.log(
				`[performRebase] "${file}" has ${conflictPositions.length} conflict region(s)`,
			);
		}

		for (const [file, conflicts] of Object.entries(fileToConflictsMap)) {
			for (const { start, end } of conflicts) {
				console.log(`[performRebase] Blaming "${file}" lines ${start}-${end}`);
				const blameInfo = await gitService.getBlame(
					file,
					start,
					end,
					branchRef,
				);
				const blamedCommitSHA = blameInfo.split(" ")[0];
				console.log(`[performRebase] Blamed commit: ${blamedCommitSHA}`);
				const blamedCommit = await gitService.getCommitFromSHA(blamedCommitSHA);
				// if blamed commit is in the merged pr branch, then we know that the change is intended
				if (
					blamedCommit &&
					commitsIntroducedByPR.some(
						(c) => c.getSHA() === blamedCommit.getSHA(),
					)
				) {
					console.log(
						`[performRebase] Blamed commit is from merged PR — resolving conflict in "${file}" by keeping incoming`,
					);
					// resolve the conflict by keeping the incoming change (i.e. the change from the merged PR)
					await gitService.resolveConflict(file, "theirs");
				} else {
					console.log(
						`[performRebase] Blamed commit is not from merged PR — cannot auto-resolve "${file}", aborting`,
					);
					await gitService.abortRebase();
					throw new Error(
						`Conflict in file ${file} could not be automatically resolved. Please resolve manually.`,
					);
				}
			}
		}

		// after resolving conflicts, continue the rebase
		console.log(
			`[performRebase] All conflicts resolved, staging and continuing rebase`,
		);
		await gitService.stageChanges(".");
		await gitService.continueRebase();
		console.log(`[performRebase] Rebase continued successfully`);
	}
}
