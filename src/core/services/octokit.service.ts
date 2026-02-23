import type { Octokit } from "octokit";
import { Commit } from "../models/commit.model";
import { PullRequest } from "../models/pull-request.model";

export class OctokitService {
	private octokit: Octokit;
	private owner: string;
	private repo: string;

	constructor(octokit: Octokit, owner: string, repo: string) {
		this.octokit = octokit;
		this.owner = owner;
		this.repo = repo;
	}

	public async getCommit(commitSHA: string): Promise<Commit | null> {
		try {
			const response = await this.octokit.rest.git.getCommit({
				owner: this.owner,
				repo: this.repo,
				commit_sha: commitSHA,
			});
			if (response.status === 200) {
				return new Commit(commitSHA, response.data.tree.sha);
			}
			return null;
		} catch {
			return null;
		}
	}

	public async getPullRequestsByBase(
		base: string,
		state: "open" | "closed",
	): Promise<PullRequest[]> {
		const response = await this.octokit.rest.pulls.list({
			owner: this.owner,
			repo: this.repo,
			base,
			state,
		});
		if (response.status !== 200) {
			throw new Error(
				`GitHub API returned status ${response.status} for pulls.list (base="${base}", state="${state}")`,
			);
		}
		return response.data.map(
			(pr: { number: number; base: { ref: string }; head: { ref: string } }) =>
				new PullRequest(pr.number, pr.base.ref, pr.head.ref),
		);
	}
}
