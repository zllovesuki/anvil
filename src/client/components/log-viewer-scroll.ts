const DEFAULT_BOTTOM_TOLERANCE_PX = 20;
const BOTTOM_PADDING_EPSILON_PX = 2;

export interface ScrollPositionSnapshot {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  paddingBottom: number;
}

export const isLogViewerPinnedToLatest = ({
  scrollTop,
  clientHeight,
  scrollHeight,
  paddingBottom,
}: ScrollPositionSnapshot) => {
  const bottomGap = Math.max(0, scrollHeight - clientHeight - scrollTop);
  const bottomTolerance = Math.max(DEFAULT_BOTTOM_TOLERANCE_PX, Math.max(0, paddingBottom) + BOTTOM_PADDING_EPSILON_PX);
  return bottomGap <= bottomTolerance;
};
