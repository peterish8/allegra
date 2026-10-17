import { ALIGN_MODEL } from './config';
import { opfsDir, readFile, writeFile } from '../liveKaraoke/roformer/opfs';
import { Sha256 } from '../liveKaraoke/roformer/sha256';

export async function loadAlignModel(gpu: boolean, progress: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const spec = gpu ? ALIGN_MODEL.gpu : ALIGN_MODEL.cpu;
  const dir = await opfsDir(['allegra-lyric-align-v1']);
  const cached = dir ? await readFile(dir, spec.file) : null;
  if (cached?.size === spec.bytes) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    if (new Sha256().update(bytes).hex() === spec.sha256) { progress(100); return bytes; }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15 * 60_000);
  try {
    const response = await fetch(`${ALIGN_MODEL.base}/onnx/${spec.file}`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Model download failed. Please try again.');
    const bytes = new Uint8Array(spec.bytes);
    const reader = response.body.getReader();
    let loaded = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (loaded + value.length > bytes.length) throw new Error('Unexpected model size.');
      bytes.set(value, loaded); loaded += value.length;
      progress(Math.floor(99 * loaded / spec.bytes));
    }
    if (loaded !== spec.bytes || new Sha256().update(bytes).hex() !== spec.sha256) throw new Error('Model verification failed. Please retry the download.');
    if (dir) await writeFile(dir, spec.file, bytes).catch(() => undefined);
    progress(100);
    return bytes;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not download the alignment model.');
  } finally { clearTimeout(timeout); }
}
