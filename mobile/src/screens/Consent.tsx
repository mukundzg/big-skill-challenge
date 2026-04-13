import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Image,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { CONSENTS, CONSENT_KEYS, ConsentKey } from '../constants/consents';
import { isLoggedIn, loadSession } from '../auth/session';
import { shouldSkipConsentScreen } from '../auth/consentSync';
import { AuthApiError, submitConsent } from '../api/auth';
import { markConsentsAccepted } from '../auth/consentStorage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Consent'>;
};

// Star background component
function StarBackground() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        <Circle cx="22" cy="82" r="1.5" fill="rgba(255,255,255,0.7)" />
        <Circle cx="56" cy="142" r="2" fill="rgba(255,255,255,0.55)" />
        <Circle cx="341" cy="91" r="1.5" fill="rgba(255,255,255,0.7)" />
        <Circle cx="361" cy="201" r="2" fill="rgba(255,255,255,0.5)" />
        <Circle cx="31" cy="281" r="1.5" fill="rgba(255,255,255,0.6)" />
        <Circle cx="85" cy="220" r="1.5" fill="rgba(255,255,255,0.5)" />
        <Circle cx="280" cy="340" r="2" fill="rgba(255,255,255,0.55)" />
        <Circle cx="45" cy="460" r="1.5" fill="rgba(255,255,255,0.45)" />
        <Circle cx="340" cy="560" r="2" fill="rgba(255,255,255,0.5)" />
      </Svg>
    </View>
  );
}

// Progress Header Step component
function ProgressStep({ number, label, active, completed }: { number: number; label?: string; active?: boolean; completed?: boolean }) {
  return (
    <View style={styles.stepContainer}>
      <View style={[
        styles.stepCircle,
        active && styles.stepCircleActive,
        completed && styles.stepCircleCompleted
      ]}>
        {completed ? (
          <Text style={styles.stepCheck}>✓</Text>
        ) : (
          <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{number}</Text>
        )}
      </View>
      {active && label && <Text style={styles.stepLabel}>{label}</Text>}
    </View>
  );
}

export function Consent({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [accepted, setAccepted] = useState<Record<ConsentKey, boolean>>({
    consent_1: false,
    consent_2: false,
    consent_3: false,
  });

  const acceptedCount = useMemo(() => {
    return Object.values(accepted).filter(Boolean).length;
  }, [accepted]);

  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAllAccepted = acceptedCount === CONSENT_KEYS.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession();
      if (cancelled) return;
      if (session == null || !isLoggedIn(session)) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home', params: {} }],
        });
        return;
      }
      const em = session.email;
      if (await shouldSkipConsentScreen(em)) {
        navigation.replace('Dashboard');
        return;
      }
      setEmail(em);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  const toggleConsent = (key: ConsentKey) => {
    setAccepted(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleContinue = useCallback(async () => {
    if (!email || !isAllAccepted) return;
    setError(null);
    try {
      const res = await submitConsent(email);
      await markConsentsAccepted(email);
      if (!res.ok) {
        /* Backend offline DB: local cache still allows continuing. */
      }
      navigation.reset({
        index: 0,
        routes: [{ name: 'Payment' }],
      });
    } catch (e) {
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not save consent.');
      }
    } finally {
    }
  }, [isAllAccepted, email, navigation]);

  if (loading || email == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#1e3c72', '#2a5298', '#20e2d7']}
        style={StyleSheet.absoluteFill}
      />
      <StarBackground />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <Image
            source={require('../../assets/images/prize-hero.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={{ width: 40 }} /> {/* Spacer */}
        </View>

        {/* Progress Bar */}
        <View style={styles.progressRow}>
          <ProgressStep number={1} completed />
          <View style={styles.progressLine} />
          <ProgressStep number={2} completed />
          <View style={styles.progressLine} />
          <ProgressStep number={3} label="Eligibility" active />
          <View style={[styles.progressLine, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
          <ProgressStep number={4} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        <Text style={styles.title}>Entry Eligibility</Text>
        <Text style={styles.subtitle}>Please confirm the following before proceeding to payment.</Text>

        <View style={styles.checklist}>
          {CONSENT_KEYS.map((key) => (
            <Pressable
              key={key}
              onPress={() => toggleConsent(key)}
              style={[
                styles.chkCard,
                accepted[key] && styles.chkCardActive
              ]}
            >
              <View style={[styles.chkBox, accepted[key] && styles.chkBoxActive]}>
                {accepted[key] && <Text style={styles.chkCheckMark}>✓</Text>}
              </View>
              <Text style={styles.chkText}>{CONSENTS[key]}</Text>
            </Pressable>
          ))}
        </View>

        {/* Summary Footer Text */}
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>{acceptedCount} / {CONSENT_KEYS.length} items confirmed</Text>
        </View>

        {error != null && <Text style={styles.error}>{error}</Text>}

        {/* Primary Action Button */}
        <Pressable
          disabled={!isAllAccepted}
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.btnPrimaryWrap,
            !isAllAccepted && styles.btnDisabled,
            pressed && { opacity: 0.8 }
          ]}
        >
          <LinearGradient
            colors={['#F59E0B', '#EA580C']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryLabel}>Continue to Payment →</Text>
          </LinearGradient>
        </Pressable>

        {/* Important Box */}
        <View style={styles.infoBox}>
          <View style={styles.infoHead}>
            <Text style={styles.infoIcon}>i</Text>
            <Text style={styles.infoTitle}>Important</Text>
          </View>
          <Text style={styles.infoText}>
            Payment is processed into a designated competition trust account. Entries are recorded upon successful quiz completion and creative submission.
          </Text>
        </View>
      </ScrollView>

      {/* Mobile Footer */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Text style={styles.footerText}>Pure skill. One prize. One winner.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08002E',
  },
  centered: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    backgroundColor: 'rgba(8,0,46,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    zIndex: 40,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 50,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  logo: {
    height: 22,
    width: 140,
  },
  error: {
    marginTop: 8,
    marginBottom: 8,
    color: '#dc2626',
    fontSize: 14,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(245, 158, 11, 0.4)',
    marginHorizontal: 4,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  stepCircleActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  stepCircleCompleted: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.4)',
  },
  stepNumberActive: {
    color: '#000',
  },
  stepCheck: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  stepLabel: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '800',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    marginBottom: 24,
  },
  checklist: {
    gap: 12,
    marginBottom: 20,
  },
  chkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  chkCardActive: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  chkBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chkBoxActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  chkCheckMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  chkText: {
    flex: 1,
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 22,
  },
  statusRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  btnPrimaryWrap: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 8,
    marginBottom: 24,
  },
  btnPrimary: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryLabel: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 17,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  infoBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    padding: 16,
  },
  infoHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  infoIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#fff',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 18,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  infoText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.45)',
    lineHeight: 20,
  },
  footer: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
