/// <reference lib="webworker" />
/**
 * Reads an import file off the main thread, so a 10,000-song download never blocks the page.
 * In: `{ file }`. Out: the reader's result (`{ bundle, fileHash }` or `{ error }`).
 */
import { readImportFile, type ReadResult } from '../../lib/importFile';

export interface ImportWorkerRequest {
  readonly file: File;
}

self.onmessage = async (event: MessageEvent<ImportWorkerRequest>): Promise<void> => {
  let result: ReadResult;
  try {
    result = await readImportFile(event.data.file);
  } catch {
    result = { error: 'unreadable' };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(result);
};
