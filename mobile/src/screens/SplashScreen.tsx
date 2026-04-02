import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { shouldSkipConsentScreen } from '../auth/consentSync';
import { isLoggedIn, loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'>;
};

/** On web, session load is so fast the splash was invisible; keep a minimum visible time. */
const MIN_SPLASH_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [session] = await Promise.all([loadSession(), delay(MIN_SPLASH_MS)]);
      if (cancelled) return;
      if (session != null && isLoggedIn(session)) {
        const consentsOk = await shouldSkipConsentScreen(session.email);
        navigation.replace(consentsOk ? 'QuizHome' : 'Home');
      } else {
        navigation.replace('Landing', {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.root}>
      <Text style={styles.logo}>Big Skill Challenge</Text>
      <Text style={styles.tagline}>Welcome</Text>
      <ActivityIndicator size="large" color="#2563eb" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 42,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  tagline: {
    marginTop: 8,
    fontSize: 16,
    color: '#94a3b8',
  },
  spinner: {
    marginTop: 40,
  },
});
