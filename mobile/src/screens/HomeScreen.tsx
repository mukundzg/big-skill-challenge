import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthApiError, isUserNotFoundError, logout, submitConsent } from '../api/auth';
import { clearConsentsAccepted, markConsentsAccepted } from '../auth/consentStorage';
import { shouldSkipConsentScreen } from '../auth/consentSync';
import { clearSession, isLoggedIn, loadSession } from '../auth/session';
import { CONSENT_KEYS, CONSENTS, type ConsentKey } from '../constants/consents';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

function initialChecks(): Record<ConsentKey, boolean> {
  return {
    consent_1: false,
    consent_2: false,
    consent_3: false,
  };
}

export function HomeScreen({ navigation }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Record<ConsentKey, boolean>>(initialChecks);
  const [agreeBusy, setAgreeBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession();
      if (cancelled) return;
      if (session == null || !isLoggedIn(session)) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Landing', params: {} }],
        });
        return;
      }
      const em = session.email;
      if (await shouldSkipConsentScreen(em)) {
        navigation.replace('QuizHome');
        return;
      }
      setEmail(em);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  const toggle = useCallback((key: ConsentKey) => {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const allChecked = CONSENT_KEYS.every((k) => checks[k]);

  const onIAgree = useCallback(async () => {
    if (!email || !allChecked) return;
    setError(null);
    setAgreeBusy(true);
    try {
      const res = await submitConsent(email);
      await markConsentsAccepted(email);
      if (!res.ok) {
        /* Backend offline DB: local cache still allows continuing. */
      }
      navigation.reset({
        index: 0,
        routes: [{ name: 'QuizHome' }],
      });
    } catch (e) {
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not save consent.');
      }
    } finally {
      setAgreeBusy(false);
    }
  }, [allChecked, email, navigation]);

  const onLogout = useCallback(async () => {
    if (!email) return;
    setError(null);
    setLogoutBusy(true);
    try {
      await logout(email);
      await clearConsentsAccepted(email);
      await clearSession();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Landing', params: {} }],
      });
    } catch (e) {
      if (isUserNotFoundError(e)) {
        await clearConsentsAccepted(email);
        await clearSession();
        navigation.reset({
          index: 0,
          routes: [{ name: 'Landing', params: { fromUserNotFound: true } }],
        });
        return;
      }
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setLogoutBusy(false);
    }
  }, [email, navigation]);

  if (loading || email == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Text style={styles.title}>Consent to use the app</Text>
        <Text style={styles.subtitle}>
          Please read and accept each item below before continuing. Signed in as{' '}
          <Text style={styles.emailInline}>{email}</Text>
        </Text>

        {CONSENT_KEYS.map((key, index) => (
          <Pressable
            key={key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checks[key] }}
            onPress={() => toggle(key)}
            style={({ pressed }) => [styles.consentRow, pressed && styles.consentRowPressed]}
          >
            <View style={[styles.checkbox, checks[key] && styles.checkboxOn]}>
              {checks[key] ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <View style={styles.consentTextWrap}>
              <Text style={styles.consentLabel}>Consent {index + 1}</Text>
              <Text style={styles.consentBody}>{CONSENTS[key]}</Text>
            </View>
          </Pressable>
        ))}

        {error != null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          disabled={!allChecked || agreeBusy}
          onPress={onIAgree}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
            (!allChecked || agreeBusy) && styles.buttonDisabled,
          ]}
        >
          {agreeBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonLabel}>I agree</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={logoutBusy}
          onPress={onLogout}
          style={styles.linkWrap}
        >
          {logoutBusy ? (
            <ActivityIndicator color="#64748b" />
          ) : (
            <Text style={styles.link}>Log out</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f5',
  },
  centered: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#18181b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#52525b',
    marginBottom: 24,
  },
  emailInline: {
    fontWeight: '600',
    color: '#18181b',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
  },
  consentRowPressed: {
    opacity: 0.92,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#a1a1aa',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#fff',
  },
  checkboxOn: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  checkmark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  consentTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  consentLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3f3f46',
    textTransform: 'capitalize',
    marginBottom: 6,
  },
  consentBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#52525b',
  },
  error: {
    marginTop: 8,
    marginBottom: 8,
    color: '#dc2626',
    fontSize: 14,
  },
  primaryButton: {
    marginTop: 16,
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
    opacity: 0.45,
  },
  primaryButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkWrap: {
    marginTop: 20,
    alignSelf: 'center',
    minHeight: 24,
    justifyContent: 'center',
  },
  link: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '600',
  },
});
