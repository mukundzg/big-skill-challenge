import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthApiError, isUserNotFoundError, logout } from '../api/auth';
import { fetchQuizDashboard, type QuizDashboard } from '../api/quiz';
import { clearConsentsAccepted } from '../auth/consentStorage';
import { clearSession, isLoggedIn, loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';
import { confirmAsync, showAlert } from '../utils/dialog';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;
};

// Star background component
function StarBackground() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        <Circle cx="22" cy="82" r="1.5" fill="rgba(255,255,255,0.7)" />
        <Circle cx="56" cy="142" r="2" fill="rgba(255,255,255,0.55)" />
        <Circle cx="341" cy="91" r="1.5" fill="rgba(255,255,255,0.7)" />
        <Circle cx="361" cy="201" r="2" fill="rgba(255,255,255,0.5)" />
        <Circle cx="31" cy="281" r="1.5" fill="rgba(255,255,255,0.6)" />
        <Circle cx="85" cy="220" r="1.5" fill="rgba(255,255,255,0.5)" />
        <Circle cx="280" cy="340" r="2" fill="rgba(255,255,255,0.55)" />
        <Circle cx="45" cy="460" r="1.5" fill="rgba(255,255,255,0.45)" />
        <Circle cx="340" cy="560" r="2" fill="rgba(255,255,255,0.5)" />
      </Svg>
    </View>
  );
}

type Tab = 'dashboard' | 'entries' | 'account';

export function DashboardScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashboard, setDashboard] = useState<QuizDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [timeLeft, setTimeLeft] = useState({ days: 89, hours: 18, mins: 0, secs: 0 });
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev.secs > 0) return { ...prev, secs: prev.secs - 1 };
        if (prev.mins > 0) return { ...prev, mins: prev.mins - 1, secs: 59 };
        if (prev.hours > 0) return { ...prev, hours: prev.hours - 1, mins: 59, secs: 59 };
        if (prev.days > 0) return { ...prev, days: prev.days - 1, hours: 23, mins: 59, secs: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
        navigation.reset({ index: 0, routes: [{ name: 'Home', params: {} }] });
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
      navigation.reset({ index: 0, routes: [{ name: 'Home', params: {} }] });
    } catch (e) {
      if (isUserNotFoundError(e)) {
        await clearConsentsAccepted(email);
        await clearSession();
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home', params: { fromUserNotFound: true } }],
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

  const onAddEntryPress = () => {
    navigation.navigate('Payment');
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (email) loadDash(email);
    });
    return unsub;
  }, [email, loadDash, navigation]);

  if (loading || email == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  // --- RENDERS ---

  const renderDashboard = () => (
    <View style={styles.tabContent}>
      {/* Incomplete Entry Widget */}
      <View style={styles.incompleteWidget}>
        <View style={styles.incompleteTextContainer}>
          <Text style={styles.incompleteLabel}>· Incomplete Entry</Text>
          <Text style={styles.incompleteSub}>Payment received — your quiz is waiting.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.resumeBtn, pressed && styles.pressed]}
          onPress={onAttemptPress}
          disabled={dashLoading || dashboard?.attempts_remaining === 0}
        >
          <LinearGradient
            colors={['#F59E0B', '#EA580C']}
            style={styles.resumeBtnGradient}
          >
            <Text style={styles.resumeBtnLabel}>Resume</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Shortlist Banner */}
      {dashboard != null && dashboard.shortlisted > 0 && (
        <Pressable style={({ pressed }) => [styles.shortlistCard, pressed && styles.pressed]}>
          <LinearGradient
            colors={['#F59E0B', '#EA580C']}
            style={styles.trophyBox}
          >
            <Text style={styles.trophyIcon}>🏆</Text>
          </LinearGradient>
          <View style={styles.shortlistTextWrap}>
            <Text style={styles.shortlistTitle}>You're Shortlisted!</Text>
            <Text style={styles.shortlistMeta}>Entry #TBSC-2026-004521 · Top 0.01%</Text>
          </View>
          <Text style={styles.arrowIcon}>›</Text>
        </Pressable>
      )}

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{dashboard?.attempts_used ?? 0}</Text>
          <Text style={styles.statKey}>Entries Used</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{dashboard?.attempts_remaining ?? 0}</Text>
          <Text style={styles.statKey}>Slots Left</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statVal, { color: '#4ADE80' }]}>{dashboard?.shortlisted ?? 0}</Text>
          <Text style={styles.statKey}>Shortlisted</Text>
        </View>
      </View>

      {/* Countdown */}
      <View style={styles.cdownCard}>
        <Text style={styles.cdownLabel}>Competition closes in:</Text>
        <View style={styles.cdownRow}>
          {[
            { val: timeLeft.days, label: 'Days' },
            { val: timeLeft.hours, label: 'Hrs' },
            { val: timeLeft.mins, label: 'Min' },
            { val: timeLeft.secs, label: 'Sec' },
          ].map((timer, i) => (
            <View key={i} style={styles.cdownBox}>
              <Text style={styles.cdownN}>{String(timer.val).padStart(2, '0')}</Text>
              <Text style={styles.cdownL}>{timer.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Add Another Entry Button */}
      <Pressable
        onPress={onAddEntryPress}
        style={({ pressed }) => [styles.addEntryBtnWrap, pressed && styles.pressed]}
      >
        <LinearGradient colors={['#F59E0B', '#EA580C']} style={styles.addEntryBtn}>
          <Text style={styles.addEntryLabel}>Add Another Entry →</Text>
        </LinearGradient>
      </Pressable>
      <Text style={styles.addEntrySub}>
        {dashboard?.attempts_used ?? 0} of {dashboard?.max_attempts ?? 10} entries used. {dashboard?.attempts_remaining ?? 0} entries remaining.
      </Text>

      {error != null && <Text style={styles.error}>{error}</Text>}
    </View>
  );

  const renderEntries = () => (
    <View style={styles.tabContent}>
      <Text style={styles.viewTitle}>My Entries</Text>
      <View style={[styles.card, { marginTop: 20 }]}>
        <Text style={styles.stat}>Total score: {dashboard?.total_score.toFixed(1) ?? '0.0'}</Text>
        <Text style={styles.stat}>
          Correct answers (all attempts): {dashboard?.total_correct_answers ?? 0}
        </Text>
        <Text style={styles.stat}>Attempts used: {dashboard?.attempts_used ?? 0}</Text>
        <Text style={styles.stat}>Attempts remaining: {dashboard?.attempts_remaining ?? 0}</Text>
      </View>
    </View>
  );

  const renderAccount = () => (
    <View style={styles.tabContent}>
      <View style={styles.profileSection}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarTxt}>{email[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{email.split('@')[0]}</Text>
        <Text style={styles.profileEmail}>{email}</Text>
      </View>

      <View style={styles.menuList}>
        <Pressable style={styles.menuItem}>
          <Text style={styles.menuLabel}>Edit Profile</Text>
          <Text style={styles.menuArrow}>›</Text>
        </Pressable>
        <Pressable style={styles.menuItem}>
          <Text style={styles.menuLabel}>Terms & Privacy</Text>
          <Text style={styles.menuArrow}>›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={logoutBusy}
          onPress={onLogout}
          style={[styles.menuItem, { borderBottomWidth: 0 }]}
        >
          {logoutBusy ? (
            <ActivityIndicator color="#F87171" />
          ) : (
            <Text style={[styles.menuLabel, { color: '#F87171' }]}>Sign Out</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#1e3c72', '#2a5298', '#20e2d7']}
        style={StyleSheet.absoluteFill}
      />
      <StarBackground />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTop}>
          <Image
            source={require('../../assets/images/prize-hero.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={styles.userBadge}>
            <Text style={styles.userName}>{email.split('@')[0]}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'entries' && renderEntries()}
        {activeTab === 'account' && renderAccount()}
      </ScrollView>

      {/* Footer Tabs */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={styles.tab} onPress={() => setActiveTab('dashboard')}>
          <Text style={[styles.tabIcon, activeTab === 'dashboard' && styles.tabActive]}>🧠</Text>
          <Text style={[styles.tabLabel, activeTab === 'dashboard' && styles.tabActive]}>
            Dashboard
          </Text>
        </Pressable>
        <Pressable style={styles.tab} onPress={() => setActiveTab('entries')}>
          <Text style={[styles.tabIcon, activeTab === 'entries' && styles.tabActive]}>🏆</Text>
          <Text style={[styles.tabLabel, activeTab === 'entries' && styles.tabActive]}>
            My Entries
          </Text>
        </Pressable>
        <Pressable style={styles.tab} onPress={() => setActiveTab('account')}>
          <Text style={[styles.tabIcon, activeTab === 'account' && styles.tabActive]}>👤</Text>
          <Text style={[styles.tabLabel, activeTab === 'account' && styles.tabActive]}>Account</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b0221',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0b0221',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    padding: 20,
  },
  header: {
    paddingHorizontal: 20,
    backgroundColor: 'rgba(11, 2, 33, 0.8)',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 40,
  },
  logo: {
    height: 26,
    width: 150,
  },
  logoTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  userBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  userName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
  },
  viewTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 10,
  },
  incompleteWidget: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(255, 158, 11, 0.05)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  incompleteTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  incompleteLabel: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '900',
  },
  incompleteSub: {
    color: 'rgba(245, 158, 11, 0.7)',
    fontSize: 13,
    marginTop: 4,
  },
  shortlistCard: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(255, 158, 11, 0.03)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  trophyBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trophyIcon: {
    fontSize: 22,
  },
  shortlistTextWrap: {
    flex: 1,
    marginLeft: 16,
  },
  shortlistTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  shortlistMeta: {
    color: 'rgba(196, 181, 253, 0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  arrowIcon: {
    color: '#F59E0B',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },
  resumeBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  resumeBtnGradient: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeBtnLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statVal: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
  },
  statKey: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  cdownCard: {
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  cdownLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
  },
  cdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cdownBox: {
    flex: 1,
    backgroundColor: 'rgba(124,58,237,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cdownN: {
    fontSize: 20,
    fontWeight: '900',
    color: '#C4B5FD',
  },
  cdownL: {
    fontSize: 9,
    color: 'rgba(196,181,253,0.6)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  addEntryBtnWrap: {
    marginTop: 32,
    borderRadius: 16,
    overflow: 'hidden',
  },
  addEntryBtn: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEntryLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  addEntrySub: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  card: {
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  stat: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
  },
  error: {
    marginTop: 12,
    color: '#F87171',
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: 'rgba(11, 2, 33, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 4,
    opacity: 0.4,
  },
  tabLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '600',
  },
  tabActive: {
    color: '#F59E0B',
    opacity: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  profileSection: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarTxt: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
  },
  profileName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  profileEmail: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    marginTop: 4,
  },
  menuList: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  menuArrow: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 20,
    fontWeight: '300',
  },
});
