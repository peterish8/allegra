import { motion, useReducedMotion } from 'motion/react';

import type { PairMatch } from '@shared/blendTypes';
import type { BlendMemberView } from '@shared/blendView';

import { motionTokens } from '../../motion';
import { MemberDisc } from './MemberDisc';

const SIZE = 240;
const RADIUS = 92;
const DISC = 36;

/**
 * A group as a ring of discs. Each pair is a line between two discs: a 1px element placed and
 * sized with transform only (translate, rotate, scaleX for length, scaleY for thickness by match).
 * The viewer's own pairs are buttons that open that pair's numbers; the rest are decoration.
 */
export function BlendRing({ members, pairs, onPair }: {
  readonly members: readonly BlendMemberView[];
  readonly pairs: readonly PairMatch[];
  readonly onPair: (pair: PairMatch) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const centre = SIZE / 2;
  const at = new Map(members.map((member, index) => {
    const angle = (index / members.length) * Math.PI * 2 - Math.PI / 2;
    return [member.userId, { x: centre + RADIUS * Math.cos(angle), y: centre + RADIUS * Math.sin(angle) }];
  }));
  const viewer = members.find((member) => member.isYou)?.userId;
  const nameOf = (userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone';

  return (
    <div className="blend-ring" style={{ width: SIZE, height: SIZE }}>
      {pairs.map((pair) => {
        const from = at.get(pair.a);
        const to = at.get(pair.b);
        if (!from || !to) return null;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const mine = viewer !== undefined && (pair.a === viewer || pair.b === viewer);
        const transform = `translate(${from.x}px, ${from.y}px) rotate(${angle}rad) scaleX(${length}) scaleY(${1 + (5 * pair.match) / 100})`;
        const line = (
          <motion.span
            className="blend-ring__line"
            style={{ transform }}
            initial={{ opacity: 0 }}
            animate={{ opacity: mine ? 1 : 0.35 }}
            transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.slow, ease: motionTokens.ease.standard }}
          />
        );
        if (!mine) return <span key={`${pair.a}|${pair.b}`} aria-hidden="true">{line}</span>;
        const other = pair.a === viewer ? pair.b : pair.a;
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        return (
          <span key={`${pair.a}|${pair.b}`}>
            <span aria-hidden="true">{line}</span>
            <button
              type="button"
              className="blend-ring__hit"
              style={{ transform: `translate(${mid.x - 22}px, ${mid.y - 22}px)` }}
              aria-label={`You and ${nameOf(other)}: ${pair.match}%`}
              onClick={() => onPair(pair)}
            />
          </span>
        );
      })}
      {members.map((member) => {
        const point = at.get(member.userId);
        return point ? (
          <span key={member.userId} className="blend-ring__disc" style={{ transform: `translate(${point.x - DISC / 2}px, ${point.y - DISC / 2}px)` }}>
            <MemberDisc member={member} size="medium" />
          </span>
        ) : null;
      })}
    </div>
  );
}
