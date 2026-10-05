import type { BlendMemberView } from '@shared/blendView';

/** Accent hues the app already uses, so discs sit in the existing palette (no new colours). */
const DISC_VARS = ['--wave', '--color-accent', '--color-accent-bright', '--color-accent-deep', '--color-field-start', '--color-field-end'] as const;

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

/** A member as initials on a coloured disc (D11): never a photo. */
export function MemberDisc({ member, size = 'medium', className = '' }: { readonly member: Pick<BlendMemberView, 'userId' | 'displayName' | 'initials'>; readonly size?: 'small' | 'medium' | 'large'; readonly className?: string }) {
  const tone = DISC_VARS[hash(member.userId) % DISC_VARS.length];
  return (
    <span className={`member-disc member-disc--${size} ${className}`} role="img" aria-label={member.displayName} style={{ ['--disc' as string]: `var(${tone})` }}>
      <span aria-hidden="true">{member.initials}</span>
    </span>
  );
}

export function MemberDiscs({ members, size = 'small' }: { readonly members: readonly Pick<BlendMemberView, 'userId' | 'displayName' | 'initials'>[]; readonly size?: 'small' | 'medium' | 'large' }) {
  return (
    <span className="member-discs">
      {members.map((member) => <MemberDisc key={member.userId} member={member} size={size} />)}
    </span>
  );
}
