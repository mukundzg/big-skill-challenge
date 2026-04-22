import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { submitCreativeEntry, submitQuizTimeout } from '../api/quiz';
import { loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';
import { showAlert } from '../utils/dialog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizCreative'>;
  route: RouteProp<RootStackParamList, 'QuizCreative'>;
};

const TOTAL_SECONDS = 120;

export function QuizCreativeScreen({ navigation, route }: Props) {
  const { attemptId } = route.params;
  const [userId, setUserId] = useState<number | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const timeoutHandledRef = useRef(false);

  useEffect(() => {
    loadSession().then((session) => {
      setUserId(session?.userId ?? null);
      setEmail(session?.email ?? null);
    });
  }, []);

  useEffect(() => {
    timeoutHandledRef.current = false;
    setSecondsLeft(TOTAL_SECONDS);
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
  }, []);

  const onTimeout = useCallback(async () => {
    if (timeoutHandledRef.current) return;
    timeoutHandledRef.current = true;
    if (email) {
      try {
        await submitQuizTimeout(email, attemptId);
      } catch {
        /* timeout fallback still navigates */
      }
    }
    navigation.reset({ index: 0, routes: [{ name: 'QuizTimeout' }] });
  }, [attemptId, email, navigation]);

  useEffect(() => {
    if (secondsLeft > 0) return;
    void onTimeout();
  }, [onTimeout, secondsLeft]);

  const countWords = useCallback((value: string) => {
    return value.trim().split(/\s+/).filter((w) => w.length > 0).length;
  }, []);

  const wordCount = useMemo(() => countWords(response), [countWords, response]);
  const wordsRemaining = 25 - wordCount;
  const exactCount = wordCount === 25;
  const warning = secondsLeft <= 20;
  const canSubmit = exactCount && !busy && userId != null;

  const timerText = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [secondsLeft]);

  const timerProgress = useMemo(() => (secondsLeft / TOTAL_SECONDS) * 100, [secondsLeft]);

  const statusText = useMemo(() => {
    if (wordCount === 0) return 'Begin typing your response above.';
    if (exactCount) return 'Your response is valid and ready for submission.';
    if (wordCount > 25) {
      const over = wordCount - 25;
      return `Too many words. Reduce by ${over} word${over === 1 ? '' : 's'}.`;
    }
    return `Your answer must be exactly 25 words. (${wordsRemaining} more needed)`;
  }, [exactCount, wordCount, wordsRemaining]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit || userId == null) return;
    setBusy(true);
    try {
      const result = await submitCreativeEntry(userId, attemptId, response.trim());
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'QuizEntryAccepted',
            params: {
              submissionId: result.submission_id,
              submittedAtIso: new Date().toISOString(),
              wordCount,
            },
          },
        ],
      });
    } catch (e) {
      showAlert('Submission failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [attemptId, canSubmit, navigation, response, userId, wordCount]);

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
            <View>
              <Text style={styles.headTitle}>Creative Submission</Text>
              <Text style={styles.headSub}>Exactly 25 words required</Text>
            </View>
            <View style={[styles.timerBox, warning && styles.timerBoxWarn]}>
              <Text style={styles.timerIcon}>T</Text>
              <Text style={[styles.timerValue, warning && styles.timerValueWarn]}>{timerText}</Text>
            </View>
          </View>
          <View style={styles.timeTrack}>
            <View
              style={[
                styles.timeFill,
                warning && styles.timeFillWarn,
                { width: `${Math.max(0, timerProgress)}%` },
              ]}
            />
          </View>
          {warning && (
            <Text style={styles.warnText}>{secondsLeft} seconds remaining. Submit now.</Text>
          )}
        </View>

        <View style={styles.main}>
          <View style={styles.promptCard}>
            <Text style={styles.promptLabel}>Your prompt</Text>
            <Text style={styles.promptText}>
              "In exactly 25 words, tell us why you should win this prize."
            </Text>
          </View>

          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>Your Response</Text>
            <Text style={[styles.wordCount, exactCount && styles.wordCountValid, wordCount > 25 && styles.wordCountOver]}>
              {wordCount} / 25
            </Text>
          </View>

          <TextInput
            value={response}
            onChangeText={setResponse}
            placeholder="Type your 25-word response here..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            textAlignVertical="top"
            editable={!busy}
            style={[
              styles.textArea,
              exactCount && styles.textAreaValid,
              wordCount > 25 && styles.textAreaOver,
            ]}
          />

          <Text
            style={[
              styles.statusText,
              exactCount && styles.statusValid,
              wordCount > 25 && styles.statusOver,
              wordCount > 0 && wordCount < 25 && styles.statusWarn,
            ]}
          >
            {statusText}
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={onSubmit}
            style={({ pressed }) => [styles.submitBtnWrap, pressed && canSubmit && styles.pressed]}
          >
            <LinearGradient
              colors={canSubmit ? ['#F59E0B', '#EA580C'] : ['#4b5563', '#374151']}
              style={styles.submitBtn}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Entry</Text>
              )}
            </LinearGradient>
          </Pressable>

          <View style={styles.warnCard}>
            <Text style={styles.warnCardIcon}>!</Text>
            <Text style={styles.warnCardText}>
              Submission is blocked unless word count is exactly 25.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function StarField() {
  const stars = [
    { top: 200, left: 20, size: 3 },
    { top: 280, right: 28, size: 4 },
    { top: 420, left: 38, size: 3 },
    { top: 520, right: 30, size: 3 },
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
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    backgroundColor: 'rgba(8,0,46,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
  },
  headSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  timerBoxWarn: {
    borderColor: 'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(248,113,113,0.1)',
  },
  timerIcon: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '700',
  },
  timerValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  timerValueWarn: {
    color: '#F87171',
  },
  timeTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  timeFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#4ADE80',
  },
  timeFillWarn: {
    backgroundColor: '#F87171',
  },
  warnText: {
    marginTop: 8,
    color: '#F87171',
    fontSize: 12,
    fontWeight: '700',
  },
  main: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  promptCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginBottom: 14,
  },
  promptLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  promptText: {
    fontSize: 14,
    lineHeight: 23,
    fontStyle: 'italic',
    color: 'rgba(255,255,255,0.8)',
  },
  fieldHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  wordCount: {
    fontSize: 14,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.5)',
  },
  wordCountValid: {
    color: '#4ADE80',
  },
  wordCountOver: {
    color: '#F87171',
  },
  textArea: {
    minHeight: 130,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
    lineHeight: 24,
  },
  textAreaValid: {
    borderColor: '#4ADE80',
  },
  textAreaOver: {
    borderColor: '#F87171',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    minHeight: 20,
    marginTop: 8,
    marginBottom: 14,
    color: 'rgba(255,255,255,0.55)',
  },
  statusValid: {
    color: '#4ADE80',
  },
  statusOver: {
    color: '#F87171',
  },
  statusWarn: {
    color: '#F59E0B',
  },
  submitBtnWrap: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  submitBtn: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  warnCard: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    backgroundColor: 'rgba(245,158,11,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  warnCardIcon: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '900',
  },
  warnCardText: {
    flex: 1,
    color: 'rgba(255,220,100,0.82)',
    fontSize: 12,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.94,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#fff',
    opacity: 0.55,
  },
});
