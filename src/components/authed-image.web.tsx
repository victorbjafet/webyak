import { Image, type ImageProps } from 'expo-image';
import { useEffect, useState } from 'react';

import { api } from '@/api/client';
import { assetNeedsAuth } from '@/lib/asset-url';

/**
 * An image whose URL may require the bearer token.
 *
 * `<img>` cannot send an Authorization header, so for those URLs we fetch the
 * bytes ourselves and hand the element a blob URL instead. Object URLs are
 * revoked on unmount — leaking them holds the decoded image in memory for the
 * life of the tab.
 */
export function AuthedImage({ uri, ...rest }: Omit<ImageProps, 'source'> & { uri?: string }) {
  const needsAuth = assetNeedsAuth(uri);
  // Keyed by the URL it was fetched for, so a stale blob is never shown against
  // a new `uri` while the next fetch is still in flight.
  const [fetched, setFetched] = useState<{ for: string; objectUrl: string } | null>(null);

  useEffect(() => {
    if (!uri || !needsAuth) return;

    let cancelled = false;
    let objectUrl: string | undefined;

    void (async () => {
      try {
        const res = await fetch(uri, { headers: { Authorization: `Bearer ${api.userToken}` } });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFetched({ for: uri, objectUrl });
      } catch {
        /* leave unresolved; the caller renders its own placeholder */
      }
    })();

    return () => {
      cancelled = true;
      // Object URLs pin the decoded image in memory until revoked.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, needsAuth]);

  const resolved = needsAuth ? (fetched && fetched.for === uri ? fetched.objectUrl : undefined) : uri;

  if (!resolved) return null;
  return <Image source={{ uri: resolved }} {...rest} />;
}
