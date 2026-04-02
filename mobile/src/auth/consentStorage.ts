import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (email: string) => `@big_skill_consents_ok_v1:${email.trim().toLowerCase()}`;

export async function hasAcceptedConsents(email: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(keyFor(email));
    return v === '1';
  } catch {
    return false;
  }
}

export async function markConsentsAccepted(email: string): Promise<void> {
  await AsyncStorage.setItem(keyFor(email), '1');
}

export async function clearConsentsAccepted(email: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(email));
}
