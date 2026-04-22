import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { loadSession } from '../auth/session';
import { fetchShortlistResult, type QuizShortlistResult } from '../api/quiz';
import type { RootStackParamList } from '../navigation/types';
import { showAlert } from '../utils/dialog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ShortlistResult'>;
};

function rankSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

export function ShortlistResultScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<QuizShortlistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRubric, setShowRubric] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        if (!session?.email) {
          if (!cancelled) setError('Session missing. Please sign in again.');
          return;
        }
        const data = await fetchShortlistResult(session.email);
        if (!cancelled) setResult(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load shortlist result.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submittedLabel = useMemo(() => {
    if (!result?.submitted_at) return '—';
    return new Date(result.submitted_at).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [result?.submitted_at]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  if (!result) {
    return (
      <View style={styles.centered}>
        <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
        <Text style={styles.errorTitle}>No shortlist result found</Text>
        <Text style={styles.errorText}>{error ?? 'Your shortlist result is not available yet.'}</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Back to Dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const topPct =
    result.rank_position != null && result.total_entries > 0
      ? Math.max((result.rank_position / result.total_entries) * 100, 0.01)
      : null;
  const title = result.status === 'WINNER' ? 'You are the Winner!' : 'Congratulations!';
  const pctLabel = topPct != null ? topPct.toFixed(2) : null;
  const scoreOutOf40 = Math.max(
    0,
    Math.min(
      result.rubric_breakdown
        .slice(0, 4)
        .reduce((acc, item) => acc + (Number.isFinite(item.score) ? Number(item.score) : 0), 0),
      40,
    ),
  );
  const scoreCirc = 2 * Math.PI * 40;
  const scoreDash = `${(scoreOutOf40 / 40) * scoreCirc} ${scoreCirc}`;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.trophyCircle}>
            <Text style={styles.trophy}>🏆</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {result.status === 'WINNER' ? 'Winner' : 'Shortlisted'} — Top {result.total_shortlisted}
            </Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {pctLabel != null ? (
              <>
                Your entry ranked in the <Text style={styles.topPct}>top {pctLabel}%</Text> of{' '}
                {result.total_entries.toLocaleString()} entries.
              </>
            ) : (
              'Your entry has progressed to the judging stage.'
            )}
          </Text>
        </View>

        <View style={styles.infoBar}>
          <Text style={styles.infoText}>
            <Text style={styles.infoStrong}>🧠 {result.engine_name}</Text> — {result.engine_description}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>AI Evaluation Score</Text>
            <Text style={styles.cardHeadMeta}>{result.engine_name}</Text>
          </View>
          <View style={styles.scoreWrap}>
            <View style={styles.scoreCircleWrap}>
              <Svg width={96} height={96} viewBox="0 0 96 96">
                <Circle cx={48} cy={48} r={40} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} />
                <Circle
                  cx={48}
                  cy={48}
                  r={40}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={8}
                  strokeDasharray={scoreDash}
                  strokeLinecap="round"
                  rotation={-90}
                  originX={48}
                  originY={48}
                />
              </Svg>
              <View style={styles.scoreCenter}>
                <Text style={styles.scoreNum}>{scoreOutOf40}</Text>
                <Text style={styles.scoreDen}>/40</Text>
              </View>
            </View>
            <View style={styles.rankInfo}>
              <Text style={styles.rankTitle}>
                Rank {result.rank_position != null ? `#${rankSuffix(result.rank_position)}` : '—'}
              </Text>
              <Text style={styles.rankSub}>of {result.total_entries.toLocaleString()} entries</Text>
              <View style={styles.proceedTag}>
                <Text style={styles.proceedText}>✅ Proceeding to judging</Text>
              </View>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.accBtn, pressed && styles.pressed]}
            onPress={() => setShowRubric((v) => !v)}
          >
            <Text style={styles.accBtnText}>View Rubric Breakdown</Text>
            <Text style={styles.accArrow}>{showRubric ? '▲' : '▼'}</Text>
          </Pressable>
          {showRubric && (
            <View style={styles.rubricWrap}>
              {result.rubric_breakdown.map((item) => {
                const max = item.max > 0 ? item.max : 100;
                const widthPct = Math.max(0, Math.min((item.score / max) * 100, 100));
                return (
                  <View key={item.label} style={styles.rubricRow}>
                    <View style={styles.rubricHead}>
                      <Text style={styles.rubricLabel}>{item.label}</Text>
                      <Text style={[styles.rubricScore, { color: item.color }]}>{item.score}</Text>
                    </View>
                    <View style={styles.rubricBar}>
                      <View style={[styles.rubricFill, { width: `${widthPct}%`, backgroundColor: item.color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Your Submission</Text>
          </View>
          <Text style={styles.sectionLabel}>Prompt</Text>
          <Text style={styles.promptText}>{result.prompt}</Text>
          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Your response</Text>
          <Text style={styles.responseText}>{result.submission_text || '—'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaItem}>✅ {result.word_count ?? 0} words</Text>
            <Text style={styles.metaItem}>🔒 Locked {submittedLabel}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What Happens Next</Text>
          {result.next_steps.map((step, idx) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepNumWrap}>
                <Text style={styles.stepNum}>{idx + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.accBtn, pressed && styles.pressed]}
            onPress={() => setShowAudit((v) => !v)}
          >
            <Text style={styles.accBtnText}>🛡 Immutable Audit Trail</Text>
            <Text style={styles.accArrow}>{showAudit ? '▲' : '▼'}</Text>
          </Pressable>
          {showAudit && (
            <View style={styles.auditWrap}>
              {result.audit_trail.map((item) => (
                <View key={`${item.event}-${item.timestamp}`} style={styles.auditRow}>
                  <Text style={styles.auditEvent}>{item.event}</Text>
                  <Text style={styles.auditTs}>{item.timestamp}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Pressable
          style={({ pressed }) => [styles.ctaWrap, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Dashboard')}
        >
          <LinearGradient colors={['#F59E0B', '#EA580C']} style={styles.cta}>
            <Text style={styles.ctaText}>View My Entries</Text>
          </LinearGradient>
        </Pressable>

        {error ? (
          <Pressable
            onPress={() => showAlert('Notice', error)}
            style={({ pressed }) => [styles.hint, pressed && styles.pressed]}
          >
            <Text style={styles.hintText}>Tap to view notice</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08002E' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#08002E' },
  scroll: { padding: 16, paddingTop: 32, paddingBottom: 32 },
  hero: { alignItems: 'center', marginBottom: 16 },
  trophyCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EA580C',
    marginBottom: 12,
  },
  trophy: { fontSize: 34 },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    backgroundColor: 'rgba(74,222,128,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  badgeText: { color: '#4ADE80', fontSize: 12, fontWeight: '700' },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', fontSize: 14, lineHeight: 22 },
  topPct: { color: '#F59E0B', fontWeight: '900' },
  infoBar: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  infoText: { color: 'rgba(180,210,255,0.85)', fontSize: 13, lineHeight: 20 },
  infoStrong: { color: '#fff', fontWeight: '800' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  cardHeadMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 },
  scoreCircleWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  scoreCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  scoreNum: { color: '#F59E0B', fontSize: 30, fontWeight: '900', lineHeight: 32 },
  scoreDen: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700' },
  rankInfo: { flex: 1 },
  rankTitle: { color: '#fff', fontSize: 33, fontWeight: '900', lineHeight: 36 },
  rankSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 3 },
  proceedTag: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    backgroundColor: 'rgba(74,222,128,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  proceedText: { color: '#4ADE80', fontSize: 12, fontWeight: '700' },
  accBtn: { minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accBtnText: { color: '#F59E0B', fontSize: 14, fontWeight: '800' },
  accArrow: { color: '#F59E0B', fontSize: 13, fontWeight: '800' },
  rubricWrap: { marginTop: 8 },
  rubricRow: { marginBottom: 10 },
  rubricHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rubricLabel: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600' },
  rubricScore: { fontSize: 13, fontWeight: '800' },
  rubricBar: { height: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  rubricFill: { height: 8, borderRadius: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  key: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  value: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  sectionLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  promptText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 22, fontStyle: 'italic' },
  responseText: { color: '#fff', fontSize: 14, lineHeight: 22, fontStyle: 'italic' },
  metaRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  metaItem: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  stepNumWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(124,58,237,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNum: { color: '#C4B5FD', fontSize: 11, fontWeight: '800' },
  stepText: { flex: 1, color: 'rgba(255,255,255,0.58)', fontSize: 13, lineHeight: 20 },
  auditWrap: { marginTop: 10 },
  auditRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 9,
  },
  auditEvent: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  auditTs: { color: 'rgba(255,255,255,0.38)', fontSize: 11 },
  ctaWrap: { borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  cta: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  pressed: { opacity: 0.86 },
  errorTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  errorText: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginBottom: 18 },
  backBtn: { backgroundColor: 'rgba(245,158,11,0.16)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  backBtnText: { color: '#F59E0B', fontWeight: '700' },
  hint: { alignSelf: 'center', marginTop: 12 },
  hintText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
});
