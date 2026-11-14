export type EqualiserMotionMode = 'static' | 'loop' | 'settle';

export const equaliserMotionMode = (active: boolean, reduceMotion: boolean): EqualiserMotionMode => {
  if (reduceMotion) return 'static';
  return active ? 'loop' : 'settle';
};
