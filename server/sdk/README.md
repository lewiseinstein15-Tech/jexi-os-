# JEXI SDK (DeepSeek Harness `packages/sdk/client` mirror)

Script JEXI from any Node script:

```js
import { JexiClient } from './sdk/client.js';

const jexi = new JexiClient({ baseUrl: 'http://127.0.0.1:3002' });

const health = await jexi.health();          // backend status
const tools  = await jexi.tools();           // full tool inventory
const answer = await jexi.chat('what time is it in Nairobi?');
console.log(answer);
```

- `chat(query, { conv, persona })` — one turn through the real pipeline,
  returns the final answer text (NDJSON stream consumed internally).
- The backend is open: no access key, no headers — just point and call.
- Point `baseUrl` at `https://jexi-brain-image.onrender.com` for the hosted
  brain or at a local dev server.
