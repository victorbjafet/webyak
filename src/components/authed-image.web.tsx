import { Image, type ImageProps } from 'expo-image';
import { useEffect, useState } from 'react';

import { api } from '@/api/client';
import { assetNeedsAuth } from '@/lib/asset-url';
import { hostOf, recordImageFailure } from '@/lib/image-debug';

/**
 * An image whose URL may require the bearer token.
 *
 * `<img>` cannot send an Authorization header, so for those URLs we fetch the
 * bytes ourselves and hand the element a blob URL instead. Object URLs are
 * revoked on unmount — leaking them holds the decoded image in memory for the
 * life of the tab.
 *
 * **Failures are visible, not silent.** This used to `return null` on any
 * problem, which meant a 404, a blocked request and a missing URL were
 * indistinguishable — the caller had already branched into the image path, so
 * its own placeholder was unreachable and the result was a blank box with no
 * way to diagnose it. Now every failure renders `fallback` and is recorded for
 * `/diagnostics` (src/lib/image-debug.ts).
 */
export function AuthedImage({
  uri,
  fallback = null,
  context = 'image',
  ...rest
}: Omit<ImageProps, 'source'> & {
  uri?: string;
  /** Rendered whenever the image can't be shown, for any reason. */
  fallback?: React.ReactNode;
  /** Where this sits in the UI, so a failure report says what broke. */
  context?: string;
}) {
  const needsAuth = assetNeedsAuth(uri);
  // Keyed by the URL it was fetched for, so a stale blob is never shown against
  // a new `uri` while the next fetch is still in flight.
  const [fetched, setFetched] = useState<{ for: string; objectUrl: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!uri || !needsAuth) return;

    let cancelled = false;
    let objectUrl: string | undefined;

    void (async () => {
      try {
        const res = await fetch(uri, { headers: { Authorization: `Bearer ${api.userToken}` } });
        if (cancelled) return;
        if (!res.ok) {
          recordImageFailure({
            reason: 'http',
            host: hostOf(uri),
            context,
            status: res.status,
          });
          setFailed(uri);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFetched({ for: uri, objectUrl });
      } catch (e) {
        if (cancelled) return;
        recordImageFailure({
          reason: 'network',
          host: hostOf(uri),
          context,
          detail: e instanceof Error ? e.message : String(e),
        });
        setFailed(uri);
      }
    })();

    return () => {
      cancelled = true;
      // Object URLs pin the decoded image in memory until revoked.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, needsAuth, context]);

  if (!uri) return <>{fallback}</>;
  if (failed === uri) return <>{fallback}</>;

  const resolved = needsAuth ? (fetched?.for === uri ? fetched.objectUrl : undefined) : uri;
  // Still fetching: render nothing rather than flashing the fallback, which
  // would otherwise appear and vanish on every authed image.
  if (!resolved) return null;

  return (
    <Image
      source={{ uri: resolved }}
      onError={(event) => {
        recordImageFailure({
          reason: 'decode',
          host: hostOf(uri),
          context,
          detail: event?.error ?? 'the element refused the bytes',
        });
        setFailed(uri);
      }}
      {...rest}
    />
  );
}
