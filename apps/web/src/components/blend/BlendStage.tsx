import type { CSSProperties } from 'react';

import type { BlendMemberView } from '@shared/blendView';

import { MatchNumber } from './MatchNumber';

/**
 * The Blend as light: one glowing orb per member, overlapping more the closer their taste.
 * Orbs blend with `screen`, so where tastes meet the colour brightens; the match sits in that overlap.
 * A Blend still waiting for its second member shows an empty, dashed orb where the friend will be.
 * Orbs only drift (transform); reduced motion keeps them still.
 */
export function BlendStage({ members, tones, match, group }: {
  readonly members: readonly BlendMemberView[];
  readonly tones: ReadonlyMap<string, string>;
  readonly match: number | undefined;
  readonly group: boolean;
}) {
  const waiting = members.length < 2;
  // 0 when tastes are identical, 1 when they share nothing: how far apart the orbs sit.
  const apart = match === undefined ? 0.6 : 1 - Math.min(99, Math.max(0, match)) / 100;
  const reach = 0.16 + 0.5 * apart;
  const seats = waiting ? 2 : members.length;
  const at = (index: number): { x: number; y: number } => {
    if (seats === 2) return { x: index === 0 ? -reach : reach, y: 0 };
    const angle = (index / seats) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.8 };
  };

  const label = (index: number): { x: number; y: number } => {
    const angle = (index / seats) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * (reach + 0.5), y: Math.sin(angle) * (reach + 0.42) };
  };

  return (
    <div className={`blend-stage${group ? ' is-group' : ''}`}>
      <div className="blend-stage__orbs" aria-hidden="true">
        {members.map((member, index) => {
          const { x, y } = at(index);
          return <span key={member.userId} className="blend-orb" style={{ '--tone': tones.get(member.userId), '--x': x, '--y': y, '--lag': index } as CSSProperties} />;
        })}
        {waiting ? <span className="blend-orb is-ghost" style={{ '--x': at(1).x, '--y': 0, '--lag': 1 } as CSSProperties} /> : null}
      </div>

      <div className="blend-stage__center">
        {match !== undefined && !waiting ? (
          <>
            <span className="blend-stage__match"><MatchNumber value={match} /></span>
            <span className="blend-stage__label">{group ? 'group match' : 'taste match'}</span>
          </>
        ) : (
          <span className="blend-stage__label">Waiting for a friend</span>
        )}
      </div>

      <ul className="blend-stage__names" aria-label="Members">
        {members.map((member, index) => {
          // Pairs: under each orb. Groups: out past each orb, along its direction from the centre.
          const { x, y } = seats === 2 ? at(index) : label(index);
          return (
            <li key={member.userId} style={{ '--tone': tones.get(member.userId), '--x': x, '--y': y } as CSSProperties}>
              {member.isYou ? 'You' : member.displayName}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
