/// <reference lib="webworker" />
import { alignCtc } from './ctc';
import { loadAlignModel } from './modelCache';
import type { AlignProgress } from './config';
import type { LyricsSyncCandidate } from '@shared/lyricSync';

const scope = self as unknown as DedicatedWorkerGlobalScope;
function progress(stage: string, percent: number, overall: number): void {
  scope.postMessage({ type: 'progress', progress: { stage, percent: Math.round(percent), overall: Math.round(overall) } satisfies AlignProgress });
}

scope.onmessage = (event: MessageEvent<{ pcm: Float32Array; candidates: LyricsSyncCandidate[]; gpu: boolean }>) => {
  void run(event.data).catch((error: unknown) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not sync this recording.' }));
};

async function run({ pcm, candidates, gpu }: { pcm: Float32Array; candidates: LyricsSyncCandidate[]; gpu: boolean }): Promise<void> {
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = 1;
  const bytes = await loadAlignModel(gpu, (p) => progress('Downloading and checking model', p, p * 0.3));
  progress('Loading model', 0, 30);
  // A GPU failure is surfaced with a CPU retry choice: never download another 241 MB without consent.
  const session = await ort.InferenceSession.create(bytes, { executionProviders: gpu ? ['webgpu'] : ['wasm'], logSeverityLevel: 3 });
  try {
    const chunks: Float32Array[] = [];
    let frames = 0;
    // 30-second windows with two seconds of context; discard edge emissions once.
    const hop = 26 * 16000;
    for (let start = 0; start < pcm.length; start += hop) {
      const left = Math.max(0, start - 2 * 16000);
      const right = Math.min(pcm.length, start + hop + 2 * 16000);
      const samples = pcm.slice(left, right);
      let mean = 0;
      for (const x of samples) mean += x;
      mean /= samples.length;
      let variance = 0;
      for (const x of samples) variance += (x - mean) ** 2;
      const scale = Math.sqrt(variance / samples.length + 1e-7);
      for (let i = 0; i < samples.length; i++) samples[i] = (samples[i]! - mean) / scale;
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = { input_values: new ort.Tensor('float32', samples, [1, samples.length]) };
      if (session.inputNames.includes('attention_mask')) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(samples.length).fill(1n), [1, samples.length]);
      const result = await session.run(feeds);
      const output = result.logits ?? result[session.outputNames[0]!];
      if (!output || output.dims[2] !== 31 || output.type !== 'float32') throw new Error('The model returned an unsupported output. Try CPU mode.');
      const count = Number(output.dims[1]);
      const from = Math.round((start - left) / (right - left) * count);
      const to = Math.round((Math.min(pcm.length, start + hop) - left) / (right - left) * count);
      chunks.push((output.data as Float32Array).slice(from * 31, to * 31)); frames += to - from;
      Object.values(result).forEach((tensor) => tensor.dispose());
      Object.values(feeds).forEach((tensor) => tensor.dispose());
      const p = Math.min(100, (start + hop) / pcm.length * 100);
      progress('Listening to the recording', p, 35 + p * 0.45);
    }
    const emissions = new Float32Array(frames * 31);
    let offset = 0;
    for (const chunk of chunks) { emissions.set(chunk, offset); offset += chunk.length; }
    const versions = candidates.map((candidate, i) => {
      const alignment = alignCtc(emissions, frames, 31, pcm.length / 16000, candidate.lines, (p) => progress(`Aligning ${candidate.script === 'latin' ? 'English' : candidate.language}`, p, 80 + (i + p / 100) / candidates.length * 20));
      return { candidate, ...alignment };
    });
    scope.postMessage({ type: 'done', versions });
  } finally { await session.release(); }
}
