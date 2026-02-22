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

	public async cloneRepo(
		repoUrl: string,
		{ bare }: { bare: boolean } = { bare: false },
	): Promise<void> {
		await $`rm -rf ${this.repoPath}`;
		await $`git clone ${bare ? "--bare" : ""} ${repoUrl} ${this.repoPath}`;
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
}
