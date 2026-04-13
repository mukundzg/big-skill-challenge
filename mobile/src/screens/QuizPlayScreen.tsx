import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { submitQuizAnswer, submitQuizTimeout } from '../api/quiz';
import { loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizPlay'>;
  route: RouteProp<RootStackParamList, 'QuizPlay'>;
};

export function QuizPlayScreen({ navigation, route }: Props) {
  const {
    attemptId,
    totalQuestions,
    timePerQuestionSeconds,
    initialQuestion,
  } = route.params;

  const [email, setEmail] = useState<string | null>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [questionIndex, setQuestionIndex] = useState(initialQuestion.index);
  const [secondsLeft, setSecondsLeft] = useState(timePerQuestionSeconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutHandledRef = useRef(false);

  useEffect(() => {
    loadSession().then((s) => setEmail(s?.email ?? null));
  }, []);

  const goHome = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
  }, [navigation]);

  const goComplete = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'QuizComplete' }] });
  }, [navigation]);

  const runTimeout = useCallback(async () => {
    const em = email;
    if (!em) {
      goHome();
      return;
    }
    setBusy(true);
    try {
      await submitQuizTimeout(em, attemptId);
    } catch {
      /* still exit */
    } finally {
      setBusy(false);
      goHome();
    }
  }, [attemptId, email, goHome]);

  useEffect(() => {
    if (!email) return;
    timeoutHandledRef.current = false;
    setSecondsLeft(timePerQuestionSeconds);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [email, questionIndex, timePerQuestionSeconds]);

  useEffect(() => {
    if (!email || secondsLeft > 0) return;
    if (timeoutHandledRef.current) return;
    timeoutHandledRef.current = true;
    void runTimeout();
  }, [email, runTimeout, secondsLeft]);

  const onSelectOption = useCallback(
    async (optionIndex: number) => {
      const em = email;
      if (!em || busy) return;
      timeoutHandledRef.current = true;
      setError(null);
      setBusy(true);
      try {
        const res = await submitQuizAnswer(em, attemptId, questionIndex, optionIndex);
        if (res.finished) {
          if (res.outcome === 'success') {
            goComplete();
          } else {
            goHome();
          }
          return;
        }
        if (res.next_question) {
          setQuestion(res.next_question);
          setQuestionIndex(res.next_question.index);
        } else {
          goHome();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to submit.');
      } finally {
        setBusy(false);
      }
    },
    [attemptId, busy, email, goComplete, goHome, questionIndex],
  );

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!email) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <Text style={styles.meta}>
        Question {questionIndex + 1} of {totalQuestions}
      </Text>
      <View style={styles.timerWrap}>
        <Text style={styles.timerLabel}>Time left</Text>
        <Text style={[styles.timer, secondsLeft <= 10 && styles.timerWarn]}>{fmt(secondsLeft)}</Text>
      </View>

      <Text style={styles.q}>{question.question}</Text>

      {question.options.map((opt, i) => (
        <Pressable
          key={`${questionIndex}-${i}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onSelectOption(i)}
          style={({ pressed }) => [styles.opt, pressed && styles.optPressed, busy && styles.optDisabled]}
        >
          <Text style={styles.optLetter}>{String.fromCharCode(65 + i)}.</Text>
          <Text style={styles.optText}>{opt}</Text>
        </Pressable>
      ))}

      {error != null && <Text style={styles.error}>{error}</Text>}
      {busy && <ActivityIndicator color="#2563eb" style={styles.spin} />}
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
  root: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: '#f4f4f5',
  },
  meta: {
    fontSize: 14,
    color: '#52525b',
    marginBottom: 8,
  },
  timerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
  },
  timerLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#18181b',
  },
  timer: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    color: '#2563eb',
  },
  timerWarn: {
    color: '#dc2626',
  },
  q: {
    fontSize: 18,
    fontWeight: '600',
    color: '#18181b',
    lineHeight: 26,
    marginBottom: 24,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
  },
  optPressed: {
    opacity: 0.9,
  },
  optDisabled: {
    opacity: 0.5,
  },
  optLetter: {
    fontWeight: '700',
    color: '#2563eb',
    width: 22,
  },
  optText: {
    flex: 1,
    fontSize: 15,
    color: '#18181b',
    lineHeight: 22,
  },
  error: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 14,
  },
  spin: {
    marginTop: 16,
  },
});
