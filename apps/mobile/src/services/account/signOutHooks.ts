/**
 * Work that needs the account's sign-in to still be valid: it runs before the session is ended.
 * Connect uses it to tell the server this phone is leaving, which a signed-out client cannot do.
 */
type Hook = () => Promise<void>;

const hooks = new Set<Hook>();
const LIMIT_MS = 1_500;

export function onBeforeSignOut(hook: Hook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/** Never rejects and never holds sign-out up for long: a slow goodbye is given up on. */
export async function runBeforeSignOut(): Promise<void> {
  if (hooks.size === 0) return;
  const work = Promise.allSettled([...hooks].map(hook => hook()));
  await Promise.race([work, new Promise<void>(resolve => { setTimeout(resolve, LIMIT_MS); })]);
}
