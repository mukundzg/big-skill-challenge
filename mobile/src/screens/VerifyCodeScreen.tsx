import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { AuthApiError, verifyCode } from '../api/auth';
import type { RootStackParamList } from '../navigation/types';

const LEN = 7;
const ALLOWED = /^[A-Z0-9]$/;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VerifyCode'>;
  route: RouteProp<RootStackParamList, 'VerifyCode'>;
};

export function VerifyCodeScreen({ navigation, route }: Props) {
  const { email } = route.params;
  const [cells, setCells] = useState<string[]>(() => Array(LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(TextInput | null)[]>([]);

  const setRef = useCallback((i: number) => (r: TextInput | null) => {
    refs.current[i] = r;
  }, []);

  const applyFromString = useCallback(
    (startIndex: number, raw: string) => {
      const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!upper) return;
      setCells((prev) => {
        const next = [...prev];
        let idx = startIndex;
        for (const ch of upper) {
          if (idx >= LEN) break;
          next[idx] = ch;
          idx += 1;
        }
        return next;
      });
      const filled = Math.min(startIndex + upper.length, LEN - 1);
      refs.current[filled]?.focus();
    },
    [],
  );

  const onChange = useCallback(
    (index: number, text: string) => {
      setError(null);
      if (text.length > 1) {
        applyFromString(index, text);
        return;
      }
      const ch = text.toUpperCase();
      if (text === '') {
        setCells((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
        return;
      }
      if (!ALLOWED.test(ch)) return;
      setCells((prev) => {
        const next = [...prev];
        next[index] = ch;
        return next;
      });
      if (index < LEN - 1) refs.current[index + 1]?.focus();
    },
    [applyFromString],
  );

  const onKeyPress = useCallback(
    (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key !== 'Backspace') return;
      if (cells[index]) return;
      if (index > 0) {
        refs.current[index - 1]?.focus();
        setCells((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
      }
    },
    [cells],
  );

  const code = cells.join('');
  const complete = code.length === LEN;

  const onConfirm = useCallback(async () => {
    if (!complete) return;
    setError(null);
    setLoading(true);
    try {
      await verifyCode(email, code);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    } catch (e) {
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }, [code, complete, email, navigation]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Enter code</Text>
        <Text style={styles.subtitle}>
          We sent a 7-character code to{' '}
          <Text style={styles.email}>{email}</Text>
        </Text>

        <View style={styles.row}>
          {cells.map((value, i) => (
            <TextInput
              key={i}
              ref={setRef(i)}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
              keyboardType="default"
              maxLength={LEN}
              onChangeText={(t) => onChange(i, t)}
              onKeyPress={(e) => onKeyPress(i, e)}
              selectTextOnFocus
              style={styles.cell}
              textAlign="center"
              value={value}
            />
          ))}
        </View>

        {error != null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          disabled={loading || !complete}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            (loading || !complete) && styles.buttonDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonLabel}>Confirm</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => navigation.goBack()}
          style={styles.linkWrap}
        >
          <Text style={styles.link}>Use a different email</Text>
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
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#18181b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#52525b',
    marginBottom: 28,
  },
  email: {
    fontWeight: '600',
    color: '#18181b',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
    maxHeight: 52,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
    borderRadius: 10,
    fontSize: 20,
    fontWeight: '700',
    color: '#18181b',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
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
    opacity: 0.45,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkWrap: {
    marginTop: 20,
    alignSelf: 'center',
  },
  link: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '600',
  },
});
