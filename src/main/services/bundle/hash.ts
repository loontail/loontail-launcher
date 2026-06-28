import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const sha256String = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

export const sha256File = (absPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
