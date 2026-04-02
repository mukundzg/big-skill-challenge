/**
 * Set EXPO_PUBLIC_API_BASE_URL in `.env` (no trailing slash).
 * - iOS Simulator: http://127.0.0.1:8000
 * - Android emulator: http://10.0.2.2:8000
 * - Physical device: http://<your-computer-LAN-IP>:8000
 */
const stripTrailingSlash = (url: string) => url.replace(/\/$/, '');

export const API_BASE_URL = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000',
);

// Metro/Expo inlines EXPO_PUBLIC_* at bundle time from `mobile/.env`
console.log('API_BASE_URL=', API_BASE_URL);
