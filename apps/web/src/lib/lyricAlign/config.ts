/** Pinned upstream revision and LFS SHA-256s, verified against Hugging Face's model API. */
export const ALIGN_MODEL = {
  base: 'https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX/resolve/2100fb247d8e43962eef24491597fbeb8b469531',
  gpu: { file: 'model_q4f16.onnx', bytes: 196703176, sha256: 'd02ba7644216c7ecf9c0189c5ee8fbebccf58e25246e69cf20e2ba21356c75ad' },
  cpu: { file: 'model_q4.onnx', bytes: 241459144, sha256: 'b6ebc85a3c80059474f14747b8e72f944b49238d32a1c413b9b958e618e204b2' }
} as const;

export const ALIGN_VOCAB: Readonly<Record<string, number>> = { a:4,b:20,c:23,d:16,e:6,f:27,g:17,h:18,i:5,j:25,k:14,l:15,m:13,n:7,o:8,p:21,q:29,r:12,s:11,t:10,u:9,v:24,w:22,x:30,y:19,z:26,"'":28 };

export interface AlignProgress { readonly stage: string; readonly percent: number; readonly overall: number }
