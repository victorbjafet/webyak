import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface NavItem {
  label: string;
  href: Href;
  /** Used for active matching; `/` matches exactly, others match as a prefix. */
  match: string;
  icon: IoniconName;
  activeIcon: IoniconName;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', match: '/', icon: 'home-outline', activeIcon: 'home' },
  {
    label: 'Explore',
    href: '/explore',
    match: '/explore',
    icon: 'compass-outline',
    activeIcon: 'compass',
  },
  {
    label: 'Alerts',
    href: '/notifications',
    match: '/notifications',
    icon: 'notifications-outline',
    activeIcon: 'notifications',
  },
  {
    label: 'Chats',
    href: '/chats',
    match: '/chats',
    icon: 'chatbubble-outline',
    activeIcon: 'chatbubble',
  },
  { label: 'You', href: '/me', match: '/me', icon: 'person-outline', activeIcon: 'person' },
];

export function isActive(pathname: string, match: string) {
  if (match === '/') return pathname === '/';
  return pathname === match || pathname.startsWith(`${match}/`);
}
