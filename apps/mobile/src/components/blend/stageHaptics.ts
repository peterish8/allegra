import * as Haptics from '../../utils/haptics';

/** The light tick when the match number lands; honours the Settings haptics switch. */
export const tapHaptic = (): void => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
