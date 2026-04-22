import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QuizEntryAccepted'>;
  route: RouteProp<RootStackParamList, 'QuizEntryAccepted'>;
};

export function QuizEntryAcceptedScreen({ navigation, route }: Props) {
  const { submissionId, submittedAtIso, wordCount } = route.params;
  const submittedAt = new Date(submittedAtIso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#08002E', '#12006E', '#1A0A7C']} style={StyleSheet.absoluteFill} />
      <StarField />

      <View style={styles.header}>
        <Image
          source={require('../../assets/images/prize-hero.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <View style={styles.main}>
        <View style={styles.icon}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Entry Accepted!</Text>
        </View>

        <Text style={styles.title}>Entry Accepted!</Text>
        <Text style={styles.sub}>Your entry has been successfully submitted and recorded.</Text>

        <View style={styles.receipt}>
          <View style={styles.row}>
            <Text style={styles.k}>Word Count</Text>
            <Text style={styles.v}>{wordCount} / 25 ✓</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.k}>Entry Reference</Text>
            <Text style={styles.v}>{submissionId}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.k}>Submitted</Text>
            <Text style={styles.v}>{submittedAt}</Text>
          </View>
          <View style={[styles.row, styles.lastRow]}>
            <Text style={styles.k}>Status</Text>
            <Text style={[styles.v, styles.statusOk]}>Entry Recorded ✓</Text>
          </View>
        </View>

        <Text style={styles.note}>
          A confirmation email has been sent to your registered email address.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })}
          style={({ pressed }) => [styles.btnWrap, pressed && styles.pressed]}
        >
          <LinearGradient colors={['#F59E0B', '#EA580C']} style={styles.btn}>
            <Text style={styles.btnText}>Return to Dashboard</Text>
          </LinearGradient>
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
    { top: 82, left: 22, size: 3 },
    { top: 92, right: 28, size: 4 },
    { top: 272, left: 32, size: 3 },
    { top: 338, right: 40, size: 4 },
    { top: 468, left: 44, size: 3 },
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
  header: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(8,0,46,0.92)',
    alignItems: 'center',
  },
  logo: {
    height: 24,
    width: 180,
  },
  main: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 36,
  },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  iconText: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
  },
  badge: {
    alignSelf: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.35)',
    backgroundColor: 'rgba(74,222,128,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 14,
  },
  badgeText: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
  },
  sub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 22,
  },
  receipt: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    padding: 14,
    marginBottom: 18,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 6,
    gap: 12,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  k: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },
  v: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  statusOk: {
    color: '#4ADE80',
  },
  note: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 22,
  },
  btnWrap: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  btn: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.92,
  },
  footer: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#fff',
    opacity: 0.55,
  },
});
