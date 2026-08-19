/**
 * B143 — WEB RUNTIME (DeepSeek Harness `packages/web/web` mirror,
 * JEXI-branded).
 *
 * The web renderer runtime: a provider registry (search/fetch providers with
 * duplicate detection and env overrides JEXI_WEB_SEARCH_PROVIDER /
 * JEXI_WEB_FETCH_PROVIDER — the dsh WebRuntime mirror), a renderer mount
 * helper, and an SSE event-stream consumer for the frontend.
 */

/** Web error codes (dsh WebError). */
export class WebError extends Error {
  constructor(message, code = 'WEB_ERROR') {
    super(message);
    this.name = 'WebError';
    this.code = code;
  }
}

/** The web runtime: provider registry + resolution. */
export class WebRuntime {
  constructor({ searchProvider = null, fetchProvider = null, env = {} } = {}) {
    this.searchProviders = new Map();
    this.fetchProviders = new Map();
    this.searchProviderId = searchProvider || env.JEXI_WEB_SEARCH_PROVIDER || null;
    this.fetchProviderId = fetchProvider || env.JEXI_WEB_FETCH_PROVIDER || null;
  }

  registerSearchProvider(provider) {
    return this._register(this.searchProviders, provider, 'search');
  }

  registerFetchProvider(provider) {
    return this._register(this.fetchProviders, provider, 'fetch');
  }

  _register(store, provider, kind) {
    if (!provider || typeof provider.id !== 'string') throw new WebError('provider needs an id', 'WEB_INVALID_PROVIDER');
    if (store.has(provider.id)) throw new WebError(`a web ${kind} provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER');
    store.set(provider.id, provider);
    return () => store.delete(provider.id);
  }

  resolveSearchProvider() {
    if (this.searchProviderId && this.searchProviders.has(this.searchProviderId)) return this.searchProviders.get(this.searchProviderId);
    return this.searchProviders.size ? [...this.searchProviders.values()][0] : null;
  }

  resolveFetchProvider() {
    if (this.fetchProviderId && this.fetchProviders.has(this.fetchProviderId)) return this.fetchProviders.get(this.fetchProviderId);
    return this.fetchProviders.size ? [...this.fetchProviders.values()][0] : null;
  }

  status() {
    return {
      ok: true,
      searchProvider: this.resolveSearchProvider()?.id || null,
      fetchProvider: this.resolveFetchProvider()?.id || null,
      searchCount: this.searchProviders.size,
      fetchCount: this.fetchProviders.size,
    };
  }
}

/** Mount a renderer into a root element (returns a dispose fn). */
export function createWebRenderer({ root, render }) {
  if (!root) throw new WebError('renderer needs a root element', 'WEB_NO_ROOT');
  if (typeof render !== 'function') throw new WebError('renderer needs a render fn', 'WEB_NO_RENDER');
  let disposed = false;
  const handle = render(root);
  return {
    dispose: () => { if (!disposed) { disposed = true; if (handle && typeof handle === 'function') handle(); } },
    isDisposed: () => disposed,
  };
}

/** SSE event-stream consumer (auto-reconnect). Returns { close, state }. */
export function createEventStream(url, { onEvent, onStatus = () => {}, reconnectMs = 5000 } = {}) {
  let closed = false;
  let es = null;
  let timer = null;
  let state = 'idle';

  const setState = (s) => { state = s; try { onStatus(s); } catch { /* noop */ } };
  const connect = () => {
    if (closed) return;
    setState('connecting');
    try {
      es = new EventSource(url);
    } catch {
      schedule();
      return;
    }
    es.onopen = () => setState('open');
    es.onmessage = (ev) => {
      try { onEvent(JSON.parse(ev.data || '{}')); } catch { try { onEvent({ type: 'raw', data: ev.data }); } catch { /* noop */ } }
    };
    es.onerror = () => { try { es.close(); } catch { /* noop */ } schedule(); };
  };
  const schedule = () => { if (!closed) { setState('reconnecting'); timer = setTimeout(connect, reconnectMs); } };
  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (es) { try { es.close(); } catch { /* noop */ } }
    setState('closed');
  };

  return { close, state: () => state };
}
