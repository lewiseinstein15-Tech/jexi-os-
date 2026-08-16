/**
 * JEXI OS — B78 chat event logger (event-sourced logging, chat channel).
 *
 * The /api/chat handler streams NDJSON, so the durable event log records what
 * the stream ACTUALLY emitted:
 *   - every incoming user message becomes a `user_message` event (source:
 *     chat, keyed by the conversation id), and
 *   - every terminal `done` event that reports a failure — including the
 *     15-minute deadline — becomes an `error` event with the component, the
 *     real message, and whether a graceful fallback covered it.
 *
 * Mounted in server/index.js right after express.json() (before any route),
 * scoped to POST /api/chat. The event log itself never throws, so this can
 * never break or slow a chat.
 */
import { appendEvent } from './EventLog.js';

function conversationId(req) {
  return String(req.headers['x-jexi-session'] || req.headers['x-forwarded-for'] || req.ip || 'default').slice(0, 120);
}

export function chatEventLogger() {
  return (req, res, next) => {
    if (req.method === 'POST' && req.path === '/api/chat') {
      const body = req.body || {};
      if (body.query || body.image) {
        const convId = conversationId(req);
        try {
          appendEvent('user_message', { source: 'chat', conversation: convId, image: !!body.image, text: String(body.query || '').slice(0, 2000) }, convId);
        } catch (e) { /* the event log must never break the chat */ }
        // Watch the NDJSON stream for terminal failures → error events.
        const write = res.write.bind(res);
        res.write = (chunk, ...rest) => {
          try {
            const s = String(chunk);
            if (s.startsWith('{') && s.includes('"type":"done"')) {
              const ev = JSON.parse(s);
              if (ev && ev.type === 'done' && ev.success === false) {
                if (ev.recoverable) {
                  appendEvent('error', { component: 'chat', message: 'request exceeded 15min deadline', fallback: 'result store keeps the terminal outcome; recovery poll follows' }, convId);
                } else {
                  appendEvent('error', {
                    component: 'chat',
                    message: String(ev.error || 'unknown chat failure').slice(0, 400),
                    fallback: /All AI providers failed|No API keys configured/.test(String(ev.error || '')) ? 'degraded message returned' : 'raw error surfaced',
                  }, convId);
                }
              }
            }
          } catch (e) { /* malformed/partial chunk — ignore */ }
          return write(chunk, ...rest);
        };
      }
    }
    next();
  };
}
