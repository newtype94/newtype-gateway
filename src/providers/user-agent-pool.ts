export class UserAgentPool {
  private agents: string[] = [
    'OpenAI/Python 1.51.0',
    'openai-node/4.67.0',
    'Mozilla/5.0 (compatible; VSCode-Copilot/1.0)',
    'python-requests/2.31.0',
  ];
  private index = 0;

  getNext(): string {
    const agent = this.agents[this.index % this.agents.length];
    this.index++;
    return agent;
  }
}
