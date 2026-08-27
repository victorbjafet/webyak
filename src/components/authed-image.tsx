import { Image, type ImageProps } from 'expo-image';

import { api } from '@/api/client';
import { assetNeedsAuth } from '@/lib/asset-url';

/**
 * Native counterpart of authed-image.web.tsx. React Native's image loader
 * accepts request headers directly, so no blob round-trip is needed here — this
 * is exactly what offsides does on Android.
 */
export function AuthedImage({ uri, ...rest }: Omit<ImageProps, 'source'> & { uri?: string }) {
  if (!uri) return null;

  return (
    <Image
      source={
        assetNeedsAuth(uri)
          ? { uri, headers: { Authorization: `Bearer ${api.userToken}` } }
          : { uri }
      }
      {...rest}
    />
  );
}
