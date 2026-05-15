import { createHash } from 'node:crypto';

import type { FetchedDocument } from '../types';

export const hashFetchedDocument = (document: FetchedDocument): string => {
  return createHash('sha256')
    .update([document.title, document.url, document.remoteRevision ?? '', document.content].join('\n'))
    .digest('hex');
};
