import { $, type ShellExpression } from "bun";
import { Commit } from "../models/commit.model";

export class GitService {
	private repoPath: string;
	private git;
	private commitMap: Map<string, Commit> = new Map();
	public constructor(repoPath: string) {
		this.repoPath = repoPath;
		this.git = this.gitIn();
	}

	private gitIn() {
		return (strings: TemplateStringsArray, ...values: ShellExpression[]) =>
			$(strings, ...values).cwd(this.repoPath);
	}

	public getRepoPath(): string {
		return this.repoPath;
	}

	public async cloneRepo(
		repoUrl: string,
		{ bare }: { bare: boolean } = { bare: false },
	): Promise<void> {
		await $`rm -rf ${this.repoPath}`;
		if (bare) {
			await $`git clone --bare ${repoUrl} ${this.repoPath}`;
		} else {
			await $`git clone ${repoUrl} ${this.repoPath}`;
		}
	}

	public async traverseToSHA(
		curr: string,
		target: string,
	): Promise<Commit[] | null> {
		const commitsString = await this
			.git`git rev-list --ancestry-path ${target}..${curr}`.text();
		const hashes = commitsString.trim().split("\n");
		hashes.push(target);
		const commits = await Promise.all(
			hashes.map(async (commit) => await this.getCommitFromSHA(commit)),
		);
		for (const commit of commits) {
			if (commit) {
				this.commitMap.set(
					commit.getSHA(),
					new Commit(commit.getSHA(), commit.getTreeSHA(), commit.getParents()),
				);
			}
		}
		return commits.filter((commit) => commit !== null);
	}

	public async getCommitFromSHA(sha: string): Promise<Commit | null> {
		let treeSHA: string;
		try {
			treeSHA = await this.git`git rev-parse ${sha}^{tree}`.text();
		} catch {
			return null;
		}
		if (!treeSHA.trim()) return null;

		const parentsString = await this
			.git`git rev-list --parents -n 1 ${sha}`.text();

		const parents = parentsString.trim().split(" ").slice(1);

		const parentCommits: Commit[] = [];
		for (const parent of parents) {
			if (!this.commitMap.has(parent)) {
				const parentCommit = await this.getCommitFromSHA(parent);
				if (parentCommit) {
					this.commitMap.set(parent, parentCommit);
				}
			}
			const parentCommit = this.commitMap.get(parent);
			if (parentCommit) {
				parentCommits.push(parentCommit);
			}
		}
		return new Commit(sha, treeSHA.trim(), parentCommits);
	}

	public async push(
		branch: string,
		{ forceWithLease }: { forceWithLease: boolean } = { forceWithLease: false },
	): Promise<void> {
		if (forceWithLease) {
			await this.git`git push --force-with-lease origin ${branch}`;
		} else {
			await this.git`git push origin ${branch}`;
		}
	}

	/**
	 * @throws if rebase fails due to conflicts, leaving conflicts to be resolved manually
	 */
	public async rebase(branchRef: string, newBaseRef: string): Promise<string> {
		await this.git`git fetch origin ${newBaseRef}`;
		await this.git`git fetch origin ${branchRef}`;
		await this.git`git switch ${branchRef}`;
		return await this.git`git rebase ${newBaseRef}`.text();
	}

	public async getBlame(
		filePath: string,
		startLine: number,
		endLine: number,
		head: string = "HEAD",
	): Promise<string> {
		const blameOutput = await this
			.git`git blame ${head} -L ${startLine},${endLine} --porcelain -- ${filePath} | grep -E '^[0-9a-f]{40}'`;
		return blameOutput.text();
	}

	public async stageChanges(filePath: string): Promise<void> {
		await this.git`git add ${filePath}`;
	}

	public async continueRebase(): Promise<void> {
		await this.git`git rebase --continue`;
	}

	public async abortRebase(): Promise<void> {
		await this.git`git rebase --abort`;
	}

	public async resolveConflict(
		filePath: string,
		resolutionStrategy: "ours" | "theirs",
	): Promise<void> {
		await this.git`git checkout --${resolutionStrategy} -- ${filePath}`;
	}
}
