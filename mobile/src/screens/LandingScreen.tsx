import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { AuthApiError, requestVerificationCode } from '../api/auth';
import { shouldSkipConsentScreen } from '../auth/consentSync';
import { isLoggedIn, loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Landing'>;
  route: RouteProp<RootStackParamList, 'Landing'>;
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function LandingScreen({ navigation, route }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromUserNotFound = route.params?.fromUserNotFound === true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession();
      if (cancelled) return;
      if (session != null && isLoggedIn(session)) {
        const consentsOk = await shouldSkipConsentScreen(session.email);
        navigation.replace(consentsOk ? 'QuizHome' : 'Home');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  const onContinue = useCallback(async () => {
    setError(null);
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await requestVerificationCode(trimmed);
      navigation.navigate('VerifyCode', { email: trimmed });
    } catch (e) {
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }, [email, navigation]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Sign in</Text>
        {fromUserNotFound && (
          <Text style={styles.notice}>
            We couldn&apos;t find your account. Enter your email below to register or sign in again.
          </Text>
        )}
        <Text style={styles.subtitle}>
          We&apos;ll email you a 7-character code to verify your address.
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!loading}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#a1a1aa"
          style={styles.input}
          value={email}
        />

        {error != null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonLabel}>Send code</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f5',
  },
  inner: {
    flex: 1,
    padding: 24,
    paddingTop: 56,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#18181b',
    marginBottom: 8,
  },
  notice: {
    fontSize: 15,
    lineHeight: 21,
    color: '#92400e',
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#52525b',
    marginBottom: 28,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#52525b',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#18181b',
  },
  error: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 14,
  },
  button: {
    marginTop: 24,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
