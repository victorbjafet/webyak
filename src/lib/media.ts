import { useWindowDimensions } from 'react-native';

/**
 * How much of the viewport a single piece of media may occupy before it gets
 * capped. A tall portrait image otherwise pushes everything below it off the
 * screen and has to be opened in the lightbox just to be seen.
 */
const VIEWPORT_FRACTION = 0.68;
const MIN_CAP = 220;

/**
 * Quoted posts get a much tighter cap. A repost is two posts stacked in one
 * card, so the quoted image is competing with the quote's own caption for the
 * same row of the feed — at full height the original swallows the comment that
 * was the point of reposting it.
 */
const QUOTED_FRACTION = 0.28;
const QUOTED_MIN_CAP = 140;

/**
 * Max height for inline media, recomputed on resize.
 *
 * `useWindowDimensions` re-renders on window resize and orientation change, so
 * this tracks the viewport rather than being measured once and cached stale.
 */
export function useMediaMaxHeight(variant: 'full' | 'quoted' = 'full') {
  const { height } = useWindowDimensions();
  if (variant === 'quoted') {
    return Math.max(QUOTED_MIN_CAP, Math.round(height * QUOTED_FRACTION));
  }
  return Math.max(MIN_CAP, Math.round(height * VIEWPORT_FRACTION));
}

/**
 * Whether an asset would exceed the cap at the given container width — i.e.
 * whether it needs letterboxing rather than filling its frame.
 */
export function exceedsCap(
  asset: { width?: number; height?: number },
  containerWidth: number,
  cap: number,
) {
  if (!asset.width || !asset.height || !containerWidth) return false;
  return (containerWidth * asset.height) / asset.width > cap;
}
