import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Path, Rect, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

const PRIZES = [
  {
    id: '1',
    title: 'BMW X5 SUV',
    value: 'A$65,000',
    tag: 'This Competition',
    badge: 'Current Prize',
    image: require('../../assets/images/bmw-x5.jpg'),
  },
  {
    id: '2',
    title: 'Luxury Caravan',
    value: 'A$120,000',
    tag: 'Next Competition',
    badge: 'Coming Soon',
    image: require('../../assets/images/caravan.jpg'),
  },
  {
    id: '3',
    title: '48ft Superyacht',
    value: 'A$1.2 Million',
    tag: 'Upcoming Competition',
    badge: 'Coming Soon',
    image: require('../../assets/images/boat.jpg'),
  },
];

const HIW_STEPS = [
  {
    num: 1,
    title: 'Register & Pay',
    desc: 'Create your account, confirm eligibility, and purchase entries. Payments held in a designated competition trust account.',
  },
  {
    num: 2,
    title: 'Complete the Qualification Quiz',
    desc: 'Pass our timed, skill-based knowledge challenge. 100% correct answers required. Questions drawn from a central bank.',
  },
  {
    num: 3,
    title: 'Submit Your 25-Word Entry',
    desc: 'Respond to the creative prompt in exactly 25 words. Your entry is sealed, checksummed, and submitted for AI evaluation.',
  },
  {
    num: 4,
    title: 'Independent Judging',
    desc: '3 independent judges verify the AI shortlist and confirm the final winner. Overseen by an independent scrutineer.',
  },
];

const AI_FEATURES = [
  { icon: '⚙️', label: 'Deterministic', desc: 'Fixed rubric — no random outputs' },
  { icon: '🛡️', label: 'Trust', desc: 'Immutable audit trail per entry' },
  { icon: '🔒', label: 'Sealed', desc: 'Submissions checksummed on submit' },
  { icon: '👩‍⚖️', label: 'Verified', desc: '3 human judges confirm all winners' },
];

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState({ days: 89, hours: 18, mins: 0, secs: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev.secs > 0) return { ...prev, secs: prev.secs - 1 };
        if (prev.mins > 0) return { ...prev, mins: prev.mins - 1, secs: 59 };
        if (prev.hours > 0) return { ...prev, hours: prev.hours - 1, mins: 59, secs: 59 };
        if (prev.days > 0) return { ...prev, days: prev.days - 1, hours: 23, mins: 59, secs: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    setActiveIndex(Math.round(index));
  };

  const renderStars = () => {
    return [
      { top: 82, left: 22, size: 3 },
      { top: 142, left: 56, size: 4 },
      { top: 91, right: 30, size: 3 },
      { top: 201, right: 10, size: 4 },
      { top: 251, left: 31, size: 3 },
      { top: 301, right: 20, size: 4 },
    ].map((s, i) => (
      <View
        key={i}
        style={[
          styles.star,
          {
            top: s.top,
            left: s.left,
            right: s.right,
            width: s.size,
            height: s.size,
            borderRadius: s.size / 2,
          },
        ]}
      />
    ));
  };

  return (
    <LinearGradient
      colors={['#1e3c72', '#2a5298', '#20e2d7']}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <View style={StyleSheet.absoluteFill}>{renderStars()}</View>

      <View style={styles.header}>
        <Image
          source={require('../../assets/images/prize-hero.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Pressable
          style={styles.signInBtn}
          onPress={() => navigation.navigate("SignIn", { fromUserNotFound: false })}
        >
          <Text style={styles.signInBtnText}>Sign In</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Hero Section */}
        <View style={styles.badgeWrap}>
          <Svg width="24" height="38" viewBox="0 0 24 36" style={styles.flameL}>
            <Path d="M12 1C7 8 2 12 6 20c1 2 3 3 4 5 0-3 2-5 4-7-1 5 2 8 2 12 2-4 4-8 2-13 2 2 3 5 2 8 2-2 3-6 1-10C17 8 14 4 12 1z" fill="#F59E0B" />
            <Path d="M12 8C9 12 8 16 10 20c1-3 3-5 4-8 0 5 2 8 0 12 3-4 4-8 2-14z" fill="#EA580C" />
          </Svg>
          <LinearGradient colors={['#F59E0B', '#D97706']} style={styles.badgeCircle}>
            <Text style={[styles.badgeText, styles.italic]}>BIG</Text>
            <Text style={[styles.badgeText, styles.italic]}>WIN</Text>
          </LinearGradient>
          <Svg width="24" height="38" viewBox="0 0 24 36" style={styles.flameR}>
            <Path d="M12 1C7 8 2 12 6 20c1 2 3 3 4 5 0-3 2-5 4-7-1 5 2 8 2 12 2-4 4-8 2-13 2 2 3 5 2 8 2-2 3-6 1-10C17 8 14 4 12 1z" fill="#F59E0B" />
            <Path d="M12 8C9 12 8 16 10 20c1-3 3-5 4-8 0 5 2 8 0 12 3-4 4-8 2-14z" fill="#EA580C" />
          </Svg>
        </View>

        <Text style={styles.heroTitle}>The Big Skill Challenge™</Text>
        <Text style={styles.heroSub}>Answer the prompt · Win the prize · Pure skill</Text>

        {/* Carousel */}
        <View style={styles.carouselContainer}>
          <FlatList
            data={PRIZES}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            renderItem={({ item }) => (
              <View style={styles.prizeSlide}>
                <View style={styles.prizeImgWrap}>
                  <Image source={item.image} style={styles.prizeImg} />
                  <LinearGradient colors={['#F59E0B', '#EA580C']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>{item.badge}</Text>
                  </LinearGradient>
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.prizeOverlay}>
                    <Text style={styles.prizeTag}>{item.tag}</Text>
                    <Text style={styles.prizeName}>{item.title}</Text>
                    <Text style={styles.prizeValue}>Value ~{item.value}</Text>
                  </LinearGradient>
                </View>
              </View>
            )}
            keyExtractor={item => item.id}
          />
          <View style={styles.dotsContainer}>
            {PRIZES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  activeIndex === i && styles.activeDot,
                ]}
              />
            ))}
          </View>
        </View>

        {/* CTA */}
        <View style={styles.ctaWrap}>
          <Pressable
            style={styles.ctaBtn}
            onPress={() => navigation.navigate("SignIn", { fromUserNotFound: false })}
          >
            <LinearGradient colors={['#F59E0B', '#EA580C']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.ctaGradient}>
              <Text style={styles.ctaText}>ENTER NOW — A$2.99</Text>
            </LinearGradient>
          </Pressable>
          <Text style={styles.fine}>A$2.99 per entry · Max 10 entries per participant · Skill-based</Text>
        </View>

        {/* How it Works */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionIcon}>⚙️</Text>
            <Text style={styles.sectionTitle}>How it Works</Text>
          </View>
          <View style={styles.hiwCard}>
            {HIW_STEPS.map((step, i) => (
              <View key={i} style={[styles.hiwItem, i === HIW_STEPS.length - 1 && styles.noBorder]}>
                <LinearGradient colors={['#7C3AED', '#4C1D95']} style={styles.hiwNum}>
                  <Text style={styles.hiwNumText}>{step.num}</Text>
                </LinearGradient>
                <View style={styles.hiwContent}>
                  <Text style={styles.hiwStepTitle}>{step.title}</Text>
                  <Text style={styles.hiwDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* AI Section */}
        <View style={styles.aiSection}>
          <Image
            source={require('../../assets/images/prize-hero.png')}
            style={styles.aiLogo}
            resizeMode="contain"
          />
          <Text style={styles.aiTitle}>AI-Assisted.{"\n"}Independently Verified.</Text>
          <View style={styles.featureCards}>
            {AI_FEATURES.map((f, i) => (
              <View key={i} style={styles.fCard}>
                <View style={styles.fIconWrap}>
                  <Text style={styles.fIcon}>{f.icon}</Text>
                </View>
                <Text style={styles.fLabel}>{f.label}</Text>
                <Text style={styles.fDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Countdown */}
        <View style={styles.cdownCard}>
          <Text style={styles.cdownLabel}>Competition closes in:</Text>
          <View style={styles.cdownRow}>
            {[
              { val: timeLeft.days, label: 'Days' },
              { val: timeLeft.hours, label: 'Hrs' },
              { val: timeLeft.mins, label: 'Min' },
              { val: timeLeft.secs, label: 'Sec' },
            ].map((timer, i) => (
              <View key={i} style={styles.cdownBox}>
                <Text style={styles.cdownN}>{String(timer.val).padStart(2, '0')}</Text>
                <Text style={styles.cdownL}>{timer.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.legalRow}>
          {['T&Cs', 'Rules', 'FAQ', 'Privacy'].map((link, i) => (
            <Text key={i} style={styles.legalLink}>{link}</Text>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Pure skill. One prize. One winner.</Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#fff',
    opacity: 0.6,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(8,0,46,0.92)',
    zIndex: 40,
  },
  logo: {
    height: 26,
    width: 150,
  },
  signInBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 36,
    justifyContent: 'center',
  },
  signInBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  badgeWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 6,
  },
  badgeCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 2,
  },
  badgeText: {
    fontSize: 30,
    fontWeight: '900',
    color: '#1A0A00',
    lineHeight: 32,
  },
  italic: {
    fontStyle: 'italic',
  },
  flameL: {
    position: 'absolute',
    right: SCREEN_WIDTH / 2 + 38,
    top: 12,
  },
  flameR: {
    position: 'absolute',
    left: SCREEN_WIDTH / 2 + 38,
    top: 12,
    transform: [{ scaleX: -1 }],
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    color: '#fff',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  heroSub: {
    textAlign: 'center',
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 14,
  },
  carouselContainer: {
    marginBottom: 12,
  },
  prizeSlide: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 16,
  },
  prizeImgWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    height: 190,
    backgroundColor: '#333',
  },
  prizeImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  activeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  prizeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  prizeTag: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  prizeName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 1,
  },
  prizeValue: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '700',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  activeDot: {
    width: 20,
    backgroundColor: '#F59E0B',
  },
  ctaWrap: {
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  ctaBtn: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  fine: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 5,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionIcon: {
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#fff',
  },
  hiwCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  hiwItem: {
    flexDirection: 'row',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  hiwNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiwNumText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  hiwContent: {
    flex: 1,
  },
  hiwStepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 3,
  },
  hiwDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 18,
  },
  aiSection: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 16,
    alignItems: 'center',
  },
  aiLogo: {
    height: 36,
    width: 200,
    marginBottom: 10,
  },
  aiTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  featureCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    width: '100%',
  },
  fCard: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 2,
  },
  fIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  fIcon: {
    fontSize: 22,
  },
  fLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 4,
  },
  fDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 16,
  },
  cdownCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 14,
  },
  cdownLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
  },
  cdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cdownBox: {
    flex: 1,
    backgroundColor: 'rgba(124,58,237,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cdownN: {
    fontSize: 20,
    fontWeight: '900',
    color: '#C4B5FD',
  },
  cdownL: {
    fontSize: 9,
    color: 'rgba(196,181,253,0.6)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  legalLink: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    textDecorationLine: 'underline',
  },
  footer: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
