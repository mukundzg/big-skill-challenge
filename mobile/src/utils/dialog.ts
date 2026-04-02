import { Alert, Platform } from 'react-native';

/** One-button message — works on web (`alert`) and native (`Alert.alert`). */
export function showAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    const text = message != null && message.length > 0 ? `${title}\n\n${message}` : title;
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(text);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * Two-step confirmation — web uses `confirm`, native uses `Alert` with Cancel / Continue.
 * Resolves `true` only when the user confirms.
 */
export function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.confirm === 'function') {
      return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
    }
    showAlert(title, message);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', style: 'default', onPress: () => resolve(true) },
    ]);
  });
}
