# Usage for @connectingmatrix/file

```ts
import { File } from '@connectingmatrix/file';
const stored = await File.upload({ fileName: 'source.zip', content, provider: 'supabase' }, ctx);
const files = await File.unzip(await File.download(stored.path, 'supabase', ctx));
```

See `../README.md` for the full contract list.
