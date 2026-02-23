export class PullRequest {
	private number: number;
	private base: string;
	private head: string;

	constructor(number: number, base: string, head: string) {
		this.number = number;
		this.base = base;
		this.head = head;
	}

	public getNumber(): number {
		return this.number;
	}

	public getBase(): string {
		return this.base;
	}

	public getHead(): string {
		return this.head;
	}
}
