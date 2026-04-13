import { useCallback, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthApiError, isUserNotFoundError, requestVerificationCode as sendOtp, verifyCode as verifyOtp } from '../api/auth';
import { useEffect, useRef } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { clearSession, saveLoggedInSession } from '../auth/session';
import { markConsentsAccepted } from '../auth/consentStorage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SignIn'>;
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// Custom Checkbox component to match prototype
function CustomCheckbox({
  label,
  checked,
  onToggle,
  children,
}: {
  label?: string;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onToggle} style={styles.chkRow}>
      <View style={[styles.chkBox, checked && styles.chkBoxOn]}>
        {checked && <Text style={styles.chkCheck}>✓</Text>}
      </View>
      <Text style={styles.chkText}>
        {label}
        {children}
      </Text>
    </Pressable>
  );
}

// Star background component
function StarBackground() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        {/* Simulating random stars based on HTML prototype logic */}
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

export function SignInScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [is18Plus, setIs18Plus] = useState(false);
  const [isTcAccepted, setIsTcAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendTimer > 0) {
      timerRef.current = setTimeout(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resendTimer]);

  const isFormValid = useMemo(() => {
    const trimmedEmail = email.trim();
    const hasValidEmail = isValidEmail(trimmedEmail);
    const hasValidOtp = otp.trim().length === 7; // Matching VerifyCodeScreen.tsx standard

    if (!isOtpSent) {
      if (activeTab === 'register') {
        return hasValidEmail && is18Plus && isTcAccepted;
      }
      return hasValidEmail;
    }

    return hasValidEmail && hasValidOtp;
  }, [activeTab, email, otp, isOtpSent, is18Plus, isTcAccepted]);

  const onSendOtp = useCallback(async () => {
    setError(null);
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await sendOtp(trimmed);
      setIsOtpSent(true);
      setResendTimer(30);
    } catch (e) {
      console.log('error', e);
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }, [email]);

  const onVerifyOtp = useCallback(async () => {
    setError(null);
    const trimmedEmail = email.trim();
    const trimmedOtp = otp.trim();

    if (trimmedOtp.length === 0) {
      setError('Please enter the OTP.');
      return;
    }

    setLoading(true);
    try {
      const res = await verifyOtp(trimmedEmail, trimmedOtp);
      const normalizedEmail = (res.email ?? trimmedEmail).trim().toLowerCase();

      if (res.is_active) {
        await saveLoggedInSession({
          email: normalizedEmail,
          userId: res.user_id,
          isActive: true,
        });
        const skipConsent = res.has_consent === true;
        if (skipConsent) {
          await markConsentsAccepted(normalizedEmail);
        }
        navigation.reset({
          index: 0,
          routes: [{ name: skipConsent ? 'Dashboard' : 'Consent' }],
        });
      } else {
        await clearSession();
        navigation.reset({
          index: 0,
          routes: [{ name: 'InactiveAccount', params: { email: normalizedEmail } }],
        });
      }
    } catch (e) {
      console.log('error', e);
      if (isUserNotFoundError(e)) {
        await clearSession();
        navigation.reset({
          index: 0,
          routes: [{ name: 'SignIn', params: { fromUserNotFound: true } }],
        });
        return;
      }
      if (e instanceof AuthApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }, [email, otp, navigation]);

  const onContinue = useCallback(() => {
    if (isOtpSent) {
      onVerifyOtp();
    } else {
      onSendOtp();
    }
  }, [isOtpSent, onVerifyOtp, onSendOtp]);

  const toggleTab = (tab: 'register' | 'login') => {
    setActiveTab(tab);
    setError(null);
    setIsOtpSent(false);
    setOtp('');
    setResendTimer(0);
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#1e3c72', '#2a5298', '#20e2d7']}
        style={StyleSheet.absoluteFill}
      />
      <StarBackground />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.navigate('Home')}
            style={styles.homeBtn}
            hitSlop={15}
          >
            <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <Path d="M9 22V12h6v10" />
            </Svg>
          </Pressable>
          <Image
            source={require('../../assets/images/prize-hero.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
          <Text style={styles.title}>
            {activeTab === 'register' ? 'Create Account' : 'Log In'}
          </Text>
          <Text style={styles.desc}>
            {activeTab === 'register'
              ? 'Join The Big Skill Challenge™ to enter'
              : 'Welcome back — log in to continue'}
          </Text>

          <View style={styles.tabs}>
            <Pressable
              onPress={() => toggleTab('register')}
              style={[styles.tab, activeTab === 'register' && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === 'register' && styles.tabTextActive]}>
                Create Account
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggleTab('login')}
              style={[styles.tab, activeTab === 'login' && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === 'login' && styles.tabTextActive]}>
                Log In
              </Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!loading && !isOtpSent}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, isOtpSent && styles.inputDisabled]}
              value={email}
            />
          </View>

          {isOtpSent && (
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Enter 7-digit verification code</Text>
                {resendTimer > 0 ? (
                  <Text style={styles.resendText}>Resend in {resendTimer}s</Text>
                ) : (
                  <Pressable onPress={onSendOtp} disabled={loading}>
                    <Text style={styles.resendLink}>Resend OTP</Text>
                  </Pressable>
                )}
              </View>

              {/* Segmented OTP Input */}
              <Pressable
                style={styles.otpContainer}
                onPress={() => otpInputRef.current?.focus()}
              >
                {Array.from({ length: 7 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.otpBox,
                      otp.length === i && styles.otpBoxActive,
                      otp.length > i && styles.otpBoxFilled,
                    ]}
                  >
                    <Text style={styles.otpText}>{otp[i] || ''}</Text>
                  </View>
                ))}
              </Pressable>

              <TextInput
                ref={otpInputRef}
                autoComplete="one-time-code"
                autoCorrect={false}
                editable={!loading}
                keyboardType="default"
                onChangeText={(t) => setOtp(t.toUpperCase().slice(0, 7))}
                value={otp}
                maxLength={7}
                autoCapitalize="characters"
                style={styles.hiddenInput}
                caretHidden
              />
            </View>
          )}


          {activeTab === 'register' && (
            <>
              <View style={styles.sep}>
                <Text style={styles.sepLabel}>Confirmations required</Text>
              </View>

              <CustomCheckbox
                checked={is18Plus}
                onToggle={() => setIs18Plus(!is18Plus)}
              >
                I confirm I am <Text style={{ fontWeight: '700' }}>18 years or older</Text>
              </CustomCheckbox>

              <CustomCheckbox
                checked={isTcAccepted}
                onToggle={() => setIsTcAccepted(!isTcAccepted)}
              >
                I agree to the{' '}
                <Text style={styles.linkTextInline}>Terms and Conditions</Text> and{' '}
                <Text style={styles.linkTextInline}>Competition Rules</Text>
              </CustomCheckbox>
            </>
          )}

          {error != null && <Text style={styles.errorText}>{error}</Text>}

          <View style={{ marginTop: 18 }}>
            <Pressable
              disabled={loading || !isFormValid}
              onPress={onContinue}
              style={({ pressed }) => [
                styles.btnPrimaryWrap,
                (loading || !isFormValid) && styles.btnDisabled,
              ]}
            >
              <LinearGradient
                colors={['#F59E0B', '#EA580C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btnPrimary}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryLabel}>
                    {!isOtpSent
                      ? 'Send OTP →'
                      : (activeTab === 'register' ? 'Verify OTP & Sign Up →' : 'Verify OTP & Log In →')}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>

          <View style={styles.helperLinks}>
            {activeTab === 'register' ? (
              <Pressable onPress={() => toggleTab('login')}>
                <Text style={styles.helperLinkText}>Already have an account? Log in here.</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => toggleTab('register')}>
                  <Text style={styles.helperLinkText}>Don&apos;t have an account? Create one.</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Pure skill. One prize. One winner.</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08002E',
  },
  header: {
    height: 60,
    backgroundColor: 'rgba(8,0,46,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 40,
    flexDirection: 'row',
  },
  homeBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 50,
  },
  logo: {
    height: 24,
    width: '100%',
  },
  scrollContent: {
    padding: 24,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 6,
  },
  desc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 20,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  tabActive: {
    backgroundColor: 'rgba(245,158,11,0.9)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
  },
  tabTextActive: {
    color: '#fff',
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: '#fff',
    minHeight: 50,
  },
  inputDisabled: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.35)',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  otpBox: {
    flex: 1,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxActive: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245,158,11,0.05)',
  },
  otpBoxFilled: {
    borderColor: 'rgba(255,255,255,0.4)',
  },
  otpText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
  },
  hiddenInput: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resendText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  resendLink: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  sep: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 14,
    marginTop: 4,
    marginBottom: 4,
  },
  sepLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 6,
  },
  chkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  chkBox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  chkBoxOn: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  chkCheck: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  chkText: {
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.8)',
    paddingTop: 2,
    flex: 1,
  },
  linkTextInline: {
    color: '#F59E0B',
    textDecorationLine: 'underline',
  },
  btnPrimaryWrap: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 8,
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    minHeight: 52,
  },
  btnPrimaryLabel: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginTop: 8,
  },
  helperLinks: {
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  helperLinkText: {
    color: '#F59E0B',
    fontSize: 13,
    textDecorationLine: 'underline',
    paddingVertical: 10,
  },
  footer: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.44, // 0.04em
    textTransform: 'uppercase',
  },
});
