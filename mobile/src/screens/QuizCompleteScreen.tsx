import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizComplete'>;
};

/** Shown after all questions in an attempt are answered correctly. */
export function QuizCompleteScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Well done</Text>
      <Text style={styles.body}>
        You completed this quiz. More content will appear here later.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'QuizHome' }] })}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text style={styles.btnLabel}>Back to quiz home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    padding: 24,
    paddingTop: 48,
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#18181b',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    color: '#52525b',
    lineHeight: 24,
    marginBottom: 28,
  },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.92,
  },
  btnLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
