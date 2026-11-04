/** One opening event per viewer binding. Reporting failure never blocks imaging. */
export class RecentOpenReporter {
  private controller = new AbortController();
  private eventId = crypto.randomUUID();
  private reported = false;
  private context: Promise<{ generation: string } | null>;

  constructor(
    private datasetId: string,
    private identity: { issuer: string; subject: string },
    private fetcher: typeof fetch = fetch
  ) {
    // Capture the context before loading. A subsequent clear invalidates this opening.
    this.context = this.json('/api/me/recent-datasets/context')
      .then(context => typeof context?.generation === 'string' && context.generation
        ? { generation: context.generation } : null)
      .catch(() => null);
  }
  private async json(url: string, options: RequestInit = {}) {
    if (this.controller.signal.aborted) throw new Error('Opening cancelled');
    // Native browser fetch must not receive this reporter as its receiver.
    const fetcher = this.fetcher;
    const response = await fetcher(url, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      ...options, signal: this.controller.signal,
    });
    if (response.status !== 200) throw new Error('Recent history unavailable');
    return response.json();
  }
  async opened(): Promise<void> {
    if (this.reported || this.controller.signal.aborted) return;
    this.reported = true;
    try {
      const context = await this.context;
      if (!context || this.controller.signal.aborted) return;
      const session = await this.json('/api/session');
      if (this.controller.signal.aborted || !session.loggedIn ||
        session.issuer !== this.identity.issuer || session.subject !== this.identity.subject ||
        typeof session.csrfToken !== 'string' || !session.csrfToken || /[\r\n]/.test(session.csrfToken) ||
        typeof session.csrfHeaderName !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(session.csrfHeaderName) ||
        /^(authorization|cookie|host|origin|referer|content-type|content-length|connection|sec-.+|proxy-.+)$/i.test(session.csrfHeaderName)) return;
      await this.json('/api/me/recent-datasets/' + encodeURIComponent(this.datasetId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [session.csrfHeaderName]: session.csrfToken },
        body: JSON.stringify({ eventId: this.eventId, generation: context.generation }),
      });
    } catch {
      // No automatic write retry or replacement context for stale openings.
    }
  }
  close() { this.controller.abort(); }
}
