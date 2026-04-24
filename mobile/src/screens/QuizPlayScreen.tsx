import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { fetchQuizQuestion, submitQuizAnswer, submitQuizTimeout } from '../api/quiz';
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
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutHandledRef = useRef(false);

  useEffect(() => {
    loadSession().then((s) => setEmail(s?.email ?? null));
  }, []);

  useEffect(() => {
    const em = email;
    if (!em) return;
    void fetchQuizQuestion(em, attemptId, questionIndex).catch(() => {
      /* submit_answer still records as fallback */
    });
  }, [attemptId, email, questionIndex]);

  const goHome = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
  }, [navigation]);

  const goComplete = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'QuizComplete', params: { attemptId } }] });
  }, [attemptId, navigation]);

  const goIncorrect = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'QuizIncorrect' }] });
  }, [navigation]);

  const goTimeout = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'QuizTimeout' }] });
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
      goTimeout();
    }
  }, [attemptId, email, goHome, goTimeout]);

  useEffect(() => {
    if (!email) return;
    timeoutHandledRef.current = false;
    setSecondsLeft(timePerQuestionSeconds);
    setSelectedOption(null);
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

  const onSelectOption = useCallback((optionIndex: number) => {
    if (busy) return;
    setError(null);
    setSelectedOption(optionIndex);
  }, [busy]);

  const onNextPress = useCallback(async () => {
    const em = email;
    if (!em || busy || selectedOption == null) return;

    timeoutHandledRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await submitQuizAnswer(em, attemptId, questionIndex, selectedOption);
      if (res.finished) {
        if (res.outcome === 'success') {
          goComplete();
        } else {
          goIncorrect();
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
      timeoutHandledRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [attemptId, busy, email, goComplete, goHome, goIncorrect, questionIndex, selectedOption]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const questionNumber = questionIndex + 1;
  const questionProgress = useMemo(() => {
    if (totalQuestions <= 0) return 0;
    return Math.min(100, (questionNumber / totalQuestions) * 100);
  }, [questionNumber, totalQuestions]);

  const timeProgress = useMemo(() => {
    if (timePerQuestionSeconds <= 0) return 0;
    return Math.max(0, (secondsLeft / timePerQuestionSeconds) * 100);
  }, [secondsLeft, timePerQuestionSeconds]);

  const warning = secondsLeft <= 10;
  const nextDisabled = selectedOption == null || busy;

  if (!email) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
      <StarField />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        stickyHeaderIndices={[0]}
      >
        <View style={styles.header}>
          <View style={styles.headRow}>
            <View style={styles.metaWrap}>
              <Text style={styles.stage}>Qualification Quiz</Text>
              <Text style={styles.meta}>
                Question {questionNumber} of {totalQuestions} · 100% pass required
              </Text>
            </View>
            <View style={[styles.timerBox, warning && styles.timerBoxWarn]}>
              <Text style={styles.timerIcon}>T</Text>
              <Text style={[styles.timer, warning && styles.timerWarn]}>{fmt(secondsLeft)}</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${questionProgress}%` }]} />
          </View>
          <View style={styles.timeTrack}>
            <View
              style={[
                styles.timeFill,
                warning && styles.timeFillWarn,
                { width: `${timeProgress}%` },
              ]}
            />
          </View>
          {warning && <Text style={styles.warnText}>Time is running out. Answer now.</Text>}
        </View>

        <View style={styles.main}>
          <View style={styles.metaRow}>
            <Text style={styles.qType}>Multiple Choice</Text>
            <Text style={styles.monitor}>Session monitored</Text>
          </View>

          <Text style={styles.q}>{question.question}</Text>

          <View>
            {question.options.map((opt, i) => {
              const selected = selectedOption === i;
              return (
                <Pressable
                  key={`${questionIndex}-${i}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy, selected }}
                  disabled={busy}
                  onPress={() => onSelectOption(i)}
                  style={({ pressed }) => [
                    styles.opt,
                    selected && styles.optSelected,
                    pressed && !busy && styles.optPressed,
                    busy && styles.optDisabled,
                  ]}
                >
                  <View style={[styles.optLetterWrap, selected && styles.optLetterWrapSelected]}>
                    <Text style={[styles.optLetter, selected && styles.optLetterSelected]}>
                      {String.fromCharCode(65 + i)}
                    </Text>
                  </View>
                  <Text style={styles.optText}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.hint}>
            {selectedOption == null ? 'Select an answer to continue' : 'Answer selected'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: nextDisabled }}
            disabled={nextDisabled}
            onPress={onNextPress}
            style={({ pressed }) => [styles.nextBtnWrap, pressed && !nextDisabled && styles.btnPressed]}
          >
            <LinearGradient
              colors={nextDisabled ? ['#4b5563', '#374151'] : ['#F59E0B', '#EA580C']}
              style={styles.nextBtn}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.nextBtnText}>Next Question</Text>
              )}
            </LinearGradient>
          </Pressable>

          {error != null && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.guard}>Anti-cheat monitoring active · Do not navigate away</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StarField() {
  const stars = [
    { top: 78, left: 24, size: 3 },
    { top: 118, right: 30, size: 4 },
    { top: 206, left: 82, size: 3 },
    { top: 302, right: 46, size: 3 },
    { top: 420, left: 32, size: 4 },
    { top: 536, right: 24, size: 3 },
  ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stars.map((star, i) => (
        <View
          key={i}
          style={[
            styles.star,
            {
              top: star.top,
              left: star.left,
              right: star.right,
              width: star.size,
              height: star.size,
              borderRadius: star.size / 2,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#08002E',
  },
  centered: {
    flex: 1,
    backgroundColor: '#08002E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 28,
  },
  header: {
    backgroundColor: 'rgba(8, 0, 46, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  metaWrap: {
    flex: 1,
  },
  stage: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  meta: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  timerBoxWarn: {
    borderColor: 'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(248,113,113,0.12)',
  },
  timerIcon: {
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '700',
    fontSize: 13,
  },
  timer: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  timerWarn: {
    color: '#F87171',
  },
  progressTrack: {
    height: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#7C3AED',
  },
  timeTrack: {
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  timeFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#4ADE80',
  },
  timeFillWarn: {
    backgroundColor: '#F87171',
  },
  warnText: {
    marginTop: 8,
    color: '#FCA5A5',
    fontWeight: '700',
    fontSize: 12,
  },
  main: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  qType: {
    color: '#C4B5FD',
    backgroundColor: 'rgba(124,58,237,0.25)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 4,
    paddingHorizontal: 11,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  monitor: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '500',
  },
  q: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 16,
  },
  opt: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 10,
  },
  optSelected: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  optPressed: {
    opacity: 0.9,
  },
  optDisabled: {
    opacity: 0.6,
  },
  optLetterWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  optLetterWrapSelected: {
    backgroundColor: '#F59E0B',
  },
  optLetter: {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '900',
    fontSize: 14,
  },
  optLetterSelected: {
    color: '#fff',
  },
  optText: {
    flex: 1,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  hint: {
    marginTop: 2,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    marginBottom: 12,
  },
  nextBtnWrap: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  nextBtn: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.95,
  },
  nextBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  error: {
    marginTop: 12,
    color: '#FCA5A5',
    textAlign: 'center',
    fontSize: 14,
  },
  guard: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.36)',
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 10,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#fff',
    opacity: 0.5,
  },
});
