import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';

import { api } from '@/api/client';
import { assetNeedsAuth } from '@/lib/asset-url';
import { hostOf, recordImageFailure } from '@/lib/image-debug';

/**
 * Native counterpart of authed-image.web.tsx. React Native's image loader
 * accepts request headers directly, so no blob round-trip is needed here — this
 * is exactly what offsides does on Android.
 *
 * Same contract as the web version: a failure renders `fallback` and is
 * recorded, rather than collapsing to nothing.
 */
export function AuthedImage({
  uri,
  fallback = null,
  context = 'image',
  ...rest
}: Omit<ImageProps, 'source'> & {
  uri?: string;
  fallback?: React.ReactNode;
  context?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);

  if (!uri || failed === uri) return <>{fallback}</>;

  return (
    <Image
      source={
        assetNeedsAuth(uri)
          ? { uri, headers: { Authorization: `Bearer ${api.userToken}` } }
          : { uri }
      }
      onError={(event) => {
        recordImageFailure({
          reason: 'decode',
          host: hostOf(uri),
          context,
          detail: event?.error ?? 'the loader rejected it',
        });
        setFailed(uri);
      }}
      {...rest}
    />
  );
}
