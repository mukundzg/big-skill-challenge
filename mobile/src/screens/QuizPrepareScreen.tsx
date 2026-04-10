import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { AuthApiError } from '../api/auth';
import { startQuizAttempt } from '../api/quiz';
import type { RootStackParamList } from '../navigation/types';

type QuizPlayParams = RootStackParamList['QuizPlay'];
import { showAlert } from '../utils/dialog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizPrepare'>;
  route: RouteProp<RootStackParamList, 'QuizPrepare'>;
};

/** Ease-out curve toward `cap` so % moves fast at first then slows (feels like real work). */
function simulatedProgress(elapsedMs: number, cap: number): number {
  return Math.min(cap, cap * (1 - Math.exp(-elapsedMs / 4200)));
}

function phaseLabel(p: number): string {
  if (p < 28) return 'Starting your quiz…';
  if (p < 55) return 'Loading questions from the bank…';
  if (p < 82) return 'Preparing your first question…';
  return 'Almost ready…';
}

export function QuizPrepareScreen({ navigation, route }: Props) {
  const { email } = route.params;
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState(phaseLabel(0));
  const [blocking, setBlocking] = useState(true);
  const doneRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      if (doneRef.current) return;
      const elapsed = Date.now() - startRef.current;
      const p = simulatedProgress(elapsed, 92);
      setPercent(p);
      setPhase(phaseLabel(p));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const finishAndGo = useCallback(
    (params: QuizPlayParams) => {
      doneRef.current = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      setPercent(100);
      setPhase('Ready!');
      setBlocking(false);
      setTimeout(() => {
        navigation.replace('QuizPlay', params);
      }, 380);
    },
    [navigation],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await startQuizAttempt(email);
        if (cancelled) return;
        if (!res.ok || res.attempt_id == null || !res.first_question) {
          setBlocking(false);
          showAlert('Cannot start', res.error ?? 'Try again later.');
          navigation.goBack();
          return;
        }
        finishAndGo({
          attemptId: res.attempt_id,
          totalQuestions: res.total_questions ?? 0,
          timePerQuestionSeconds: res.time_per_question_seconds ?? 60,
          marksPerQuestion: res.marks_per_question ?? 10,
          initialQuestion: res.first_question,
        });
      } catch (e) {
        if (cancelled) return;
        setBlocking(false);
        if (e instanceof AuthApiError) {
          showAlert('Error', e.message);
        } else {
          showAlert('Error', e instanceof Error ? e.message : 'Failed to start.');
        }
        navigation.goBack();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, finishAndGo, navigation]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => blocking);
    return () => sub.remove();
  }, [blocking]);

  const rounded = Math.min(100, Math.round(percent));

  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color="#2563eb" style={styles.spinner} />
      <Text style={styles.pct}>{rounded}%</Text>
      <Text style={styles.phase}>{phase}</Text>
      <Text style={styles.hint}>We load questions from the server; this is usually quick.</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${rounded}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: {
    marginBottom: 20,
  },
  pct: {
    fontSize: 44,
    fontWeight: '800',
    color: '#18181b',
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
  },
  phase: {
    fontSize: 17,
    fontWeight: '600',
    color: '#3f3f46',
    marginBottom: 8,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 320,
  },
  track: {
    width: '100%',
    maxWidth: 320,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e4e4e7',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
  },
});
