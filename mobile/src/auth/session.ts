import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@big_skill_auth_session_v1';

export type AuthSession = {
  email: string;
  userId: number | null;
  isActive: boolean;
};

export function isLoggedIn(session: AuthSession | null): boolean {
  return session != null && session.isActive === true;
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
    if (!email) return null;
    const userId =
      typeof o.userId === 'number'
        ? o.userId
        : typeof o.userId === 'string' && o.userId !== ''
          ? Number(o.userId)
          : null;
    const isActive = o.isActive === true;
    return {
      email,
      userId: Number.isFinite(userId as number) ? (userId as number) : null,
      isActive,
    };
  } catch {
    return null;
  }
}

/** Persist only when the user is logged in (`is_active` from API). */
export async function saveLoggedInSession(session: AuthSession): Promise<void> {
  if (!session.isActive) {
    await clearSession();
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
