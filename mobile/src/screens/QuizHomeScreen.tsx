import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthApiError, isUserNotFoundError, logout } from '../api/auth';
import { fetchQuizDashboard, type QuizDashboard } from '../api/quiz';
import { clearConsentsAccepted } from '../auth/consentStorage';
import { clearSession, isLoggedIn, loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';
import { confirmAsync, showAlert } from '../utils/dialog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizHome'>;
};

export function QuizHomeScreen({ navigation }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashboard, setDashboard] = useState<QuizDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const loadDash = useCallback(async (em: string) => {
    setDashLoading(true);
    setError(null);
    try {
      const d = await fetchQuizDashboard(em);
      setDashboard(d);
    } catch (e) {
      setDashboard(null);
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(
          e instanceof Error && e.message
            ? `Could not load quiz stats. ${e.message}`
            : 'Could not load quiz stats. Check your connection and try again.',
        );
      }
    } finally {
      setDashLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession();
      if (cancelled) return;
      if (session == null || !isLoggedIn(session)) {
        navigation.reset({ index: 0, routes: [{ name: 'Landing', params: {} }] });
        return;
      }
      setEmail(session.email);
      await loadDash(session.email);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDash, navigation]);

  const onAttemptPress = useCallback(async () => {
    if (!email || !dashboard) return;
    if (dashboard.attempts_remaining <= 0) {
      showAlert('No attempts left', 'You have used all quiz attempts.');
      return;
    }
    const ok = await confirmAsync(
      'Start attempt?',
      'This will count as one quiz attempt. Continue?',
    );
    if (!ok) return;
    setError(null);
    navigation.navigate('QuizPrepare', { email });
  }, [dashboard, email, navigation]);

  const onLogout = useCallback(async () => {
    if (!email) return;
    setLogoutBusy(true);
    try {
      await logout(email);
      await clearConsentsAccepted(email);
      await clearSession();
      navigation.reset({ index: 0, routes: [{ name: 'Landing', params: {} }] });
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
      }
    } finally {
      setLogoutBusy(false);
    }
  }, [email, navigation]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (email) loadDash(email);
    });
    return unsub;
  }, [email, loadDash, navigation]);

  if (loading || email == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Quiz home</Text>
      <Text style={styles.email}>{email}</Text>

      {dashLoading && !dashboard && <ActivityIndicator color="#2563eb" style={styles.spin} />}

      {dashboard != null && (
        <View style={styles.card}>
          <Text style={styles.stat}>Total score: {dashboard.total_score.toFixed(1)}</Text>
          <Text style={styles.stat}>Correct answers (all attempts): {dashboard.total_correct_answers}</Text>
          <Text style={styles.stat}>Attempts used: {dashboard.attempts_used}</Text>
          <Text style={styles.stat}>Attempts remaining: {dashboard.attempts_remaining}</Text>
          <Text style={styles.hint}>
            Max {dashboard.max_attempts} attempts · {dashboard.time_per_question_seconds}s per question ·{' '}
            {dashboard.marks_per_question} marks each
          </Text>
        </View>
      )}

      {error != null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={
          error != null ||
          dashboard == null ||
          dashboard.attempts_remaining <= 0 ||
          (dashLoading && dashboard == null)
        }
        onPress={onAttemptPress}
        style={({ pressed }) => [
          styles.primary,
          pressed && styles.pressed,
          (error != null ||
            dashboard == null ||
            dashboard.attempts_remaining <= 0 ||
            (dashLoading && dashboard == null)) &&
            styles.disabled,
        ]}
      >
        <Text style={styles.primaryLabel}>Attempt quiz</Text>
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
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    padding: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#18181b',
  },
  email: {
    marginTop: 6,
    fontSize: 14,
    color: '#52525b',
  },
  spin: {
    margin: 20,
  },
  card: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
  },
  stat: {
    fontSize: 16,
    color: '#18181b',
    marginBottom: 8,
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    color: '#71717a',
    lineHeight: 18,
  },
  error: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 14,
  },
  primary: {
    marginTop: 24,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.45,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkWrap: {
    marginTop: 20,
    alignSelf: 'center',
    minHeight: 24,
  },
  link: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '600',
  },
});
