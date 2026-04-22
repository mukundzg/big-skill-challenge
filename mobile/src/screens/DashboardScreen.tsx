import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  fetchMyEntries,
  fetchQuizDashboard,
  fetchShortlistResult,
  type QuizDashboard,
  type QuizEntry,
  type QuizShortlistResult,
} from '../api/quiz';
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
  const [entries, setEntries] = useState<QuizEntry[]>([]);
  const [shortlistResult, setShortlistResult] = useState<QuizShortlistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDash = useCallback(async (em: string) => {
    setDashLoading(true);
    setError(null);
    try {
      const d = await fetchQuizDashboard(em);
      setDashboard(d);
      if (d.shortlisted > 0) {
        try {
          const sr = await fetchShortlistResult(em);
          setShortlistResult(sr);
        } catch {
          setShortlistResult(null);
        }
      } else {
        setShortlistResult(null);
      }
    } catch (e) {
      setDashboard(null);
      setShortlistResult(null);
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

  const loadEntries = useCallback(async (em: string) => {
    try {
      const rows = await fetchMyEntries(em);
      setEntries(rows);
    } catch {
      setEntries([]);
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
      await Promise.all([loadDash(session.email), loadEntries(session.email)]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDash, loadEntries, navigation]);

  const onAttemptPress = useCallback(async () => {
    if (!email || !dashboard) return;
    if (dashboard.contest_is_active !== true) {
      showAlert('No active contests', 'No active contests are available at the moment.');
      return;
    }
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
    if (!dashboard) return;
    if (dashboard.contest_is_active !== true) {
      showAlert('No active contests', 'No active contests are available at the moment.');
      return;
    }
    if (dashboard.attempts_used >= dashboard.max_attempts || dashboard.attempts_remaining <= 0) {
      showAlert('Entry limit reached', 'You have already used all 10 entries.');
      return;
    }
    navigation.navigate('Payment');
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (!email) return;
      void loadDash(email);
      void loadEntries(email);
    });
    return unsub;
  }, [email, loadDash, loadEntries, navigation]);

  const contestEndMs = useMemo(() => {
    const raw = dashboard?.contest_season_end;
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }, [dashboard?.contest_season_end]);
  const shortlistMeta = useMemo(() => {
    if (!shortlistResult) return 'Tap to view result';
    const ref = shortlistResult.reference || 'Entry';
    const rank = shortlistResult.rank_position;
    const total = shortlistResult.total_entries;
    if (rank != null && total > 0) {
      const pct = Math.max((rank / total) * 100, 0.01);
      return `${ref} · Top ${pct.toFixed(2)}%`;
    }
    return ref;
  }, [shortlistResult]);
  const isWinnerBanner = shortlistResult?.status === 'WINNER';
  const shortlistBannerTitle = shortlistResult?.status === 'WINNER' ? "You're the Winner!" : "You're Shortlisted!";
  const contestActive = dashboard?.contest_is_active === true && contestEndMs != null && contestEndMs > nowMs;
  const timeLeft = useMemo(() => {
    if (!contestActive || contestEndMs == null) {
      return { days: 0, hours: 0, mins: 0, secs: 0 };
    }
    const totalSec = Math.max(0, Math.floor((contestEndMs - nowMs) / 1000));
    return {
      days: Math.floor(totalSec / 86400),
      hours: Math.floor((totalSec % 86400) / 3600),
      mins: Math.floor((totalSec % 3600) / 60),
      secs: totalSec % 60,
    };
  }, [contestActive, contestEndMs, nowMs]);

  if (loading || email == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  // --- RENDERS ---
  const entriesExhausted =
    (dashboard?.attempts_used ?? 0) >= (dashboard?.max_attempts ?? 10) ||
    (dashboard?.attempts_remaining ?? 0) <= 0 ||
    !contestActive;

  const renderDashboard = () => (
    <View style={styles.tabContent}>
      {/* Incomplete Entry Widget */}
      <View style={styles.incompleteWidget}>
        <View style={styles.incompleteTextContainer}>
          <Text style={styles.incompleteLabel}>· Incomplete Entry</Text>
          <Text style={styles.incompleteSub}>Payment received — your quiz is waiting.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.resumeBtn,
            pressed && styles.pressed,
            (!contestActive || dashLoading || dashboard?.attempts_remaining === 0) && styles.resumeDisabled,
          ]}
          onPress={onAttemptPress}
          disabled={!contestActive || dashLoading || dashboard?.attempts_remaining === 0}
        >
          <LinearGradient
            colors={
              !contestActive || dashboard?.attempts_remaining === 0
                ? ['#4b5563', '#374151']
                : ['#F59E0B', '#EA580C']
            }
            style={styles.resumeBtnGradient}
          >
            <Text style={styles.resumeBtnLabel}>Resume</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Shortlist Banner */}
      {dashboard != null && dashboard.shortlisted > 0 && (
        <Pressable
          style={({ pressed }) => [
            styles.shortlistCard,
            isWinnerBanner && styles.winnerCard,
            pressed && styles.pressed,
          ]}
          onPress={() => navigation.navigate('ShortlistResult')}
        >
          <LinearGradient
            colors={isWinnerBanner ? ['#16A34A', '#15803D'] : ['#F59E0B', '#EA580C']}
            style={styles.trophyBox}
          >
            <Text style={styles.trophyIcon}>{isWinnerBanner ? '👑' : '🏆'}</Text>
          </LinearGradient>
          <View style={styles.shortlistTextWrap}>
            <Text style={styles.shortlistTitle}>{shortlistBannerTitle}</Text>
            <Text style={[styles.shortlistMeta, isWinnerBanner && styles.winnerMeta]}>{shortlistMeta}</Text>
          </View>
          <Text style={[styles.arrowIcon, isWinnerBanner && styles.winnerArrowIcon]}>›</Text>
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
        <Text style={styles.cdownLabel}>
          {contestActive ? 'Competition closes in:' : 'No active contests'}
        </Text>
        {contestActive ? (
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
        ) : (
          <Text style={styles.noContestText}>
            No active contests right now. Entry actions are disabled until a new season is active.
          </Text>
        )}
      </View>

      {/* Add Another Entry Button */}
      <Pressable
        disabled={entriesExhausted}
        onPress={onAddEntryPress}
        style={({ pressed }) => [
          styles.addEntryBtnWrap,
          pressed && !entriesExhausted && styles.pressed,
          entriesExhausted && styles.addEntryDisabled,
        ]}
      >
        <LinearGradient
          colors={entriesExhausted ? ['#4b5563', '#374151'] : ['#F59E0B', '#EA580C']}
          style={styles.addEntryBtn}
        >
          <Text style={styles.addEntryLabel}>Add Another Entry →</Text>
        </LinearGradient>
      </Pressable>
      <Text style={styles.addEntrySub}>
        {entriesExhausted
          ? !contestActive
            ? 'No active contests. Add Another Entry is currently disabled.'
            : `Entry limit reached. ${dashboard?.attempts_used ?? 0} of ${dashboard?.max_attempts ?? 10} entries used.`
          : `${dashboard?.attempts_used ?? 0} of ${dashboard?.max_attempts ?? 10} entries used. ${dashboard?.attempts_remaining ?? 0} entries remaining.`}
      </Text>

      {error != null && <Text style={styles.error}>{error}</Text>}
    </View>
  );

  const renderEntries = () => (
    <View style={styles.tabContent}>
      <View style={styles.entriesHead}>
        <Text style={styles.viewTitle}>My Entries</Text>
        <Text style={styles.entriesHeadMeta}>
          {dashboard?.attempts_used ?? 0} of {dashboard?.max_attempts ?? 10} used
        </Text>
      </View>
      {entries.length === 0 ? (
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.stat}>No entries found yet.</Text>
        </View>
      ) : (
        entries.map((entry) => {
          const dt = entry.submitted_at ? new Date(entry.submitted_at) : null;
          const dateLabel = dt
            ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';
          const canOpenShortlistResult = entry.status === 'SHORTLISTED' || entry.status === 'WINNER';
          const statusTone =
            entry.status === 'SUCCESS' || entry.status === 'SHORTLISTED' || entry.status === 'WINNER'
              ? styles.entryStatusSuccess
              : entry.status === 'IN_PROGRESS'
                ? styles.entryStatusPending
                : styles.entryStatusFail;
          return (
            <Pressable
              key={entry.attempt_id}
              style={({ pressed }) => [styles.entryCard, pressed && canOpenShortlistResult && styles.pressed]}
              onPress={() => {
                if (!canOpenShortlistResult) return;
                navigation.navigate('ShortlistResult');
              }}
              disabled={!canOpenShortlistResult}
            >
              <View style={styles.entryHead}>
                <Text style={[styles.entryStatus, statusTone]}>{entry.status_label}</Text>
                <Text style={styles.entryDate}>{dateLabel}</Text>
              </View>
              <Text style={styles.entryRef}>{entry.reference}</Text>
              {entry.word_count != null && (
                <Text style={styles.entrySub}>{entry.word_count} words submitted</Text>
              )}
              {canOpenShortlistResult && <Text style={styles.entryLink}>View result details ›</Text>}
            </Pressable>
          );
        })
      )}
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
  winnerCard: {
    backgroundColor: 'rgba(22, 163, 74, 0.08)',
    borderColor: 'rgba(74, 222, 128, 0.35)',
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
  winnerMeta: {
    color: 'rgba(187, 247, 208, 0.85)',
  },
  arrowIcon: {
    color: '#F59E0B',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },
  winnerArrowIcon: {
    color: '#4ADE80',
  },
  resumeBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  resumeDisabled: {
    opacity: 0.7,
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
  noContestText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    lineHeight: 19,
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
  addEntryDisabled: {
    opacity: 0.7,
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
  entriesHead: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  entriesHeadMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
  },
  entryCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: 13,
    marginBottom: 10,
  },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  entryStatus: {
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 99,
    overflow: 'hidden',
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  entryStatusSuccess: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    color: '#4ADE80',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
  },
  entryStatusPending: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    color: '#F59E0B',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  entryStatusFail: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    color: '#F87171',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.28)',
  },
  entryDate: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
  },
  entryRef: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  entrySub: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 4,
  },
  entryLink: {
    marginTop: 8,
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
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
