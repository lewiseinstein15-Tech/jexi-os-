# JEXI SDK (DeepSeek Harness `packages/sdk/client` mirror)

Script JEXI from any Node script:

```js
import { JexiClient } from './sdk/client.js';

const jexi = new JexiClient({ baseUrl: 'http://127.0.0.1:3002', key: 'your-key' });

const health = await jexi.health();          // backend status
const tools  = await jexi.tools();           // full tool inventory
const answer = await jexi.chat('what time is it in Nairobi?');
console.log(answer);
```

- `chat(query, { conv, persona })` — one turn through the real pipeline,
  returns the final answer text (NDJSON stream consumed internally).
- The access key is read from the constructor, `JEXI_API_KEY`, or passed per
  call — same key the app uses in Settings → System.
- Point `baseUrl` at `https://jexi-brain-image.onrender.com` for the hosted
  brain (send your key) or at a local dev server.
