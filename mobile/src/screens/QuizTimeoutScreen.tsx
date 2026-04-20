import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthApiError, isUserNotFoundError, logout } from '../api/auth';
import { clearConsentsAccepted } from '../auth/consentStorage';
import { clearSession, loadSession } from '../auth/session';
import type { RootStackParamList } from '../navigation/types';
import { showAlert } from '../utils/dialog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizTimeout'>;
};

export function QuizTimeoutScreen({ navigation }: Props) {
  const [logoutBusy, setLogoutBusy] = useState(false);

  const onLogout = useCallback(async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      const session = await loadSession();
      const email = session?.email;
      if (!email) {
        await clearSession();
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        return;
      }

      await logout(email);
      await clearConsentsAccepted(email);
      await clearSession();
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      if (isUserNotFoundError(e)) {
        const session = await loadSession();
        if (session?.email) {
          await clearConsentsAccepted(session.email);
        }
        await clearSession();
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        return;
      }
      if (e instanceof AuthApiError) {
        showAlert('Logout failed', e.message);
      } else {
        showAlert('Logout failed', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setLogoutBusy(false);
    }
  }, [logoutBusy, navigation]);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
      <StarField />

      <View style={styles.main}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>T</Text>
        </View>

        <Text style={styles.title}>Time Expired</Text>
        <Text style={styles.sub}>
          You did not answer the question within the allowed time.
        </Text>
        <Text style={styles.subStrong}>Your current attempt has ended.</Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            An email notification will be sent confirming this incomplete attempt. You may
            purchase another entry (max 10 per competition) to try again.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })}
          style={({ pressed }) => [styles.homeBtnWrap, pressed && styles.pressed]}
        >
          <LinearGradient colors={['#F59E0B', '#EA580C']} style={styles.homeBtn}>
            <Text style={styles.homeBtnText}>Return to Competition Home</Text>
          </LinearGradient>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={logoutBusy}
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && !logoutBusy && styles.pressed,
            logoutBusy && styles.disabled,
          ]}
        >
          {logoutBusy ? (
            <ActivityIndicator color="#F87171" />
          ) : (
            <Text style={styles.logoutBtnText}>Log Out</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Pure skill. One prize. One winner.</Text>
      </View>
    </View>
  );
}

function StarField() {
  const stars = [
    { top: 80, left: 22, size: 3 },
    { top: 95, right: 28, size: 4 },
    { top: 270, left: 30, size: 3 },
    { top: 338, right: 45, size: 4 },
    { top: 448, left: 58, size: 3 },
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
  root: {
    flex: 1,
    backgroundColor: '#08002E',
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 22,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  icon: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
  },
  title: {
    color: '#F59E0B',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
  },
  sub: {
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 6,
  },
  subStrong: {
    color: 'rgba(255,255,255,0.88)',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 22,
  },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.28)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
  },
  infoText: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: 13,
    lineHeight: 21,
  },
  homeBtnWrap: {
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  homeBtn: {
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  logoutBtn: {
    minHeight: 50,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  logoutBtnText: {
    color: '#F87171',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.7,
  },
  footer: {
    backgroundColor: 'rgba(8,0,46,0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#fff',
    opacity: 0.5,
  },
});
