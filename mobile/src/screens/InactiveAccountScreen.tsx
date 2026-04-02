import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'InactiveAccount'>;
  route: RouteProp<RootStackParamList, 'InactiveAccount'>;
};

export function InactiveAccountScreen({ navigation, route }: Props) {
  const { email } = route.params;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Account inactive</Text>
      <Text style={styles.body}>
        Your account ({email}) is not active, so you cannot use the app right now. Contact support if
        you believe this is a mistake.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          navigation.reset({
            index: 0,
            routes: [{ name: 'Landing', params: {} }],
          })
        }
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    padding: 24,
    paddingTop: 56,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#18181b',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    color: '#52525b',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
