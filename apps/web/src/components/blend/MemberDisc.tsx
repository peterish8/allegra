import { createContext, useContext } from 'react';

import type { BlendMemberView } from '@shared/blendView';

import { memberTones } from '../../lib/blendTones';

/** The open Blend's member colours, so discs, orbs and track stripes agree. Empty outside a Blend. */
export const BlendTones = createContext<ReadonlyMap<string, string>>(new Map());

/** A member as initials on a coloured disc (D11): never a photo. */
export function MemberDisc({ member, size = 'medium', className = '' }: { readonly member: Pick<BlendMemberView, 'userId' | 'displayName' | 'initials'>; readonly size?: 'small' | 'medium' | 'large'; readonly className?: string }) {
  const tone = useContext(BlendTones).get(member.userId) ?? memberTones([member]).get(member.userId);
  return (
    <span className={`member-disc member-disc--${size} ${className}`} role="img" aria-label={member.displayName} style={{ ['--disc' as string]: tone }}>
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
