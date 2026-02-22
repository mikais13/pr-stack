import type { Octokit } from "octokit";
import { Commit } from "../models/commit.model";

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
}
