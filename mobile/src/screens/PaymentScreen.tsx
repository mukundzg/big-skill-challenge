import React, { useCallback, useEffect, useState } from 'react';
import {
	StyleSheet,
	Text,
	View,
	ScrollView,
	Pressable,
	TextInput,
	Image,
	Dimensions,
	Platform,
	KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { confirmAsync } from '../utils/dialog';
import { isLoggedIn, loadSession } from '../auth/session';
import { AuthApiError } from '../api/auth';
import { markQuizPaymentSuccess } from '../api/quiz';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
	navigation: NativeStackNavigationProp<RootStackParamList, 'Payment'>;
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

export function PaymentScreen({ navigation }: Props) {
	const insets = useSafeAreaInsets();
	const [isSuccess, setIsSuccess] = useState(false);
	const [email, setEmail] = useState('');
	const [cardNumber, setCardNumber] = useState('');
	const [expiry, setExpiry] = useState('');
	const [cvc, setCvc] = useState('');
	const [nameOnCard, setNameOnCard] = useState('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		(async () => {
			const session = await loadSession();
			if (session == null || !isLoggedIn(session)) {
				navigation.reset({ index: 0, routes: [{ name: 'Home', params: {} }] });
				return;
			}
			setEmail(session.email);
		})();
	}, [navigation]);

	const handlePay = useCallback(async () => {
		if (!email) return;
		setError(null);
		try {
			const res = await markQuizPaymentSuccess(email);
			if (!res.ok) {
				setError('Payment could not be confirmed. Please try again.');
				return;
			}
			setIsSuccess(true);
		} catch (e) {
			if (e instanceof AuthApiError) {
				setError(e.message);
			} else {
				setError(e instanceof Error ? e.message : 'Payment could not be confirmed.');
			}
		}
	}, [email]);

	const handleStartQuiz = useCallback(async () => {
		if (!email) return;
		const ok = await confirmAsync(
			'Start attempt?',
			'This will count as one quiz attempt. Continue?',
		);
		if (!ok) return;
		setError(null);
		navigation.navigate('QuizPrepare', { email });
	}, [email, navigation]);

	if (isSuccess) {
		return (
			<View style={styles.root}>
				<LinearGradient
					colors={['#1e3c72', '#2a5298', '#20e2d7']}
					style={StyleSheet.absoluteFill}
				/>
				<StarBackground />

				<ScrollView contentContainerStyle={[styles.scrollContentSuccess, { paddingTop: insets.top + 20 }]} bounces={false}>
					<View style={styles.successHeader}>
						<LinearGradient
							colors={['#4ADE80', '#16A34A']}
							style={styles.successIconCircle}
						>
							<Text style={styles.successCheckmark}>✓</Text>
						</LinearGradient>
						<Text style={styles.successTitle}>Payment Successful</Text>
						<Text style={styles.successSubtitle}>Your payment has been received and recorded.</Text>
						<Text style={styles.successCta}>You may now begin the qualification quiz.</Text>
					</View>

					{/* Receipt Card */}
					<View style={styles.receiptCard}>
						<Text style={styles.receiptLabel}>PAYMENT RECEIPT</Text>
						<View style={styles.receiptRow}>
							<Text style={styles.receiptKey}>Competition</Text>
							<Text style={styles.receiptVal}>The Big Skill Challenge™</Text>
						</View>
						<View style={styles.receiptRow}>
							<Text style={styles.receiptKey}>Prize</Text>
							<Text style={styles.receiptVal}>BMW X5 SUV</Text>
						</View>
						<View style={styles.receiptRow}>
							<Text style={styles.receiptKey}>Entry Fee Paid</Text>
							<Text style={styles.receiptVal}>A$2.99</Text>
						</View>
						<View style={styles.receiptRow}>
							<Text style={styles.receiptKey}>Reference</Text>
							<Text style={styles.receiptVal}>TBSC-2026-004521</Text>
						</View>
						<View style={[styles.receiptRow, { borderBottomWidth: 0 }]}>
							<Text style={styles.receiptKey}>Trust Account</Text>
							<Text style={[styles.receiptVal, { color: '#4ADE80' }]}>Confirmed ✓</Text>
						</View>
					</View>

					{/* Rules Box */}
					<View style={styles.rulesBox}>
						<View style={styles.rulesHead}>
							<Text style={styles.rulesIconMain}>⚠️</Text>
							<Text style={styles.rulesTitle}>Important — Before You Begin</Text>
						</View>

						<View style={styles.ruleItem}>
							<View style={[styles.ruleIconWrap, { backgroundColor: 'rgba(124, 58, 237, 0.2)' }]}>
								<Text style={styles.ruleIcon}>⏱</Text>
							</View>
							<Text style={styles.ruleText}>Each question is timed — answer within the time limit</Text>
						</View>

						<View style={styles.ruleItem}>
							<View style={[styles.ruleIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
								<Text style={styles.ruleIcon}>✓</Text>
							</View>
							<Text style={styles.ruleText}>You must answer <Text style={{ fontWeight: '700' }}>all questions correctly</Text> — 100% pass required</Text>
						</View>

						<View style={styles.ruleItem}>
							<View style={[styles.ruleIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
								<Text style={styles.ruleIcon}>❌</Text>
							</View>
							<Text style={styles.ruleText}>If timed out or incorrect, <Text style={{ color: '#F87171' }}>the attempt ends</Text></Text>
						</View>

						<View style={styles.ruleItem}>
							<View style={[styles.ruleIconWrap, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
								<Text style={styles.ruleIcon}>🔄</Text>
							</View>
							<Text style={styles.ruleText}>You may purchase additional entries to try again (max 10 total)</Text>
						</View>
					</View>

					{/* Start Button */}
					<Pressable
						onPress={handleStartQuiz}
						style={({ pressed }) => [
							styles.btnPayWrap,
							{ marginTop: 10 },
							pressed && { opacity: 0.9 }
						]}
					>
						<LinearGradient
							colors={['#F59E0B', '#EA580C']}
							style={styles.btnPay}
						>
							<Text style={styles.btnPayLabel}>Start Quiz →</Text>
						</LinearGradient>
					</Pressable>

					{error != null && <Text style={styles.error}>{error}</Text>}

				</ScrollView>

				<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
					<Text style={styles.footerText}>Pure skill. One prize. One winner.</Text>
				</View>
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

			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				style={{ flex: 1 }}
			>
				{/* Header */}
				<View style={[styles.header, { paddingTop: insets.top }]}>
					<View style={styles.headerContent}>
						<Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
							<Text style={styles.backBtnText}>←</Text>
						</Pressable>
						<View style={styles.headerTitles}>
							<Text style={styles.headerTitle}>Secure Checkout</Text>
							<Text style={styles.headerSubtitle}>Powered by Stripe</Text>
						</View>
						<View style={styles.stripeLogoPlaceholder}>
							<Text style={styles.stripeText}>stripe</Text>
						</View>
					</View>
				</View>

				<ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
					{/* Order Banner */}
					<View style={styles.orderBanner}>
						<View style={styles.merchantRow}>
							<View style={styles.merchantIcon}>
								<Image
									source={require('../../assets/images/prize-hero.png')}
									style={styles.logoMini}
									resizeMode="contain"
								/>
							</View>
							<View>
								<Text style={styles.merchantName}>The Big Skill Challenge™</Text>
								<Text style={styles.merchantUrl}>bigskillchallenge.com.au</Text>
							</View>
						</View>

						<View style={styles.priceRow}>
							<Text style={styles.priceCurrency}>AUD A$</Text>
							<Text style={styles.priceAmount}>2.99</Text>
						</View>
						<Text style={styles.itemDetail}>BMW X5 SUV — 1 Competition Entry</Text>

						<View style={styles.trustBadge}>
							<Text style={styles.trustIcon}>🛡️</Text>
							<Text style={styles.trustText}>TRUST ACCOUNT</Text>
						</View>
					</View>

					{/* Payment Sheet */}
					<View style={styles.paymentSheet}>
						<View style={styles.section}>
							<Text style={styles.label}>CONTACT</Text>
							<View style={styles.inputGroup}>
								<Text style={styles.fieldLabel}>Email</Text>
								<TextInput
									style={styles.input}
									placeholder="you@example.com"
									placeholderTextColor="#9CA3AF"
									keyboardType="email-address"
									autoCapitalize="none"
									value={email}
									onChangeText={setEmail}
								/>
							</View>
						</View>

						<View style={styles.section}>
							<View style={styles.dividerRow}>
								<View style={styles.divider} />
								<Text style={styles.dividerText}>PAYMENT DETAILS</Text>
								<View style={styles.divider} />
							</View>

							<Text style={styles.fieldLabel}>Card information</Text>
							<View style={styles.cardGroup}>
								<View style={styles.cardNumberRow}>
									<TextInput
										style={[styles.input, styles.inputNoBottomRadius, { borderBottomWidth: 0 }]}
										placeholder="1234 1234 1234 1234"
										placeholderTextColor="#9CA3AF"
										keyboardType="numeric"
										value={cardNumber}
										onChangeText={setCardNumber}
									/>
									<View style={styles.cardIcons}>
										<Text style={styles.cardIcon}>Visa</Text>
									</View>
								</View>
								<View style={styles.cardExpiryCvcRow}>
									<TextInput
										style={[styles.input, styles.inputNoTopRadius, { borderRightWidth: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 8, flex: 1.2 }]}
										placeholder="MM / YY"
										placeholderTextColor="#9CA3AF"
										keyboardType="numeric"
										value={expiry}
										onChangeText={setExpiry}
									/>
									<TextInput
										style={[styles.input, styles.inputNoTopRadius, { borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 8, flex: 1 }]}
										placeholder="CVC"
										placeholderTextColor="#9CA3AF"
										keyboardType="numeric"
										secureTextEntry
										value={cvc}
										onChangeText={setCvc}
									/>
								</View>
							</View>

							<View style={[styles.inputGroup, { marginTop: 16 }]}>
								<Text style={styles.fieldLabel}>Name on card</Text>
								<TextInput
									style={styles.input}
									placeholder="Full name as on card"
									placeholderTextColor="#9CA3AF"
									value={nameOnCard}
									onChangeText={setNameOnCard}
								/>
							</View>

							<View style={[styles.inputGroup, { marginTop: 16 }]}>
								<Text style={styles.fieldLabel}>Country or region</Text>
								<View style={[styles.input, styles.pickerPlaceholder]}>
									<Text style={styles.pickerText}>🇦🇺 Australia</Text>
									<Text style={styles.pickerArrow}>▾</Text>
								</View>
							</View>
						</View>

						{/* Session Recovery Notice */}
						<View style={styles.recoveryNotice}>
							<Text style={styles.recoveryIcon}>⚠️</Text>
							<Text style={styles.recoveryText}>
								<Text style={{ fontWeight: '700' }}>Session recovery:</Text> If payment succeeds but you never open the quiz, your entry credit is preserved and you can resume within the competition window. Once the quiz has started, leaving the app uses that attempt.
							</Text>
						</View>

						{/* Pay Button */}
						<Pressable
							onPress={handlePay}
							style={({ pressed }) => [
								styles.btnPayWrap,
								pressed && { opacity: 0.9 }
							]}
						>
							<LinearGradient
								colors={['#F59E0B', '#EA580C']}
								style={styles.btnPay}
							>
								<Text style={styles.btnPayIcon}>🔒</Text>
								<Text style={styles.btnPayLabel}>Pay A$2.99</Text>
							</LinearGradient>
						</Pressable>

						{/* Security Badges */}
						<View style={styles.securityBadges}>
							<Text style={styles.securityText}>TLS 1.3 | PCI DSS | 3D Secure</Text>
							<View style={styles.stripeBranding}>
								<Text style={styles.stripeBrandingText}>Powered by </Text>
								<Text style={[styles.stripeBrandingText, { fontWeight: '800' }]}>stripe</Text>
							</View>
						</View>

						{/* Legal Links */}
						<View style={styles.legalLinks}>
							<Text style={styles.legalLinkText}>Terms & Conditions</Text>
							<Text style={styles.legalDot}>•</Text>
							<Text style={styles.legalLinkText}>Privacy Policy</Text>
						</View>
						<Text style={styles.fineprint}>
							Entry fee processed into a designated competition trust account. Entries valid for this competition only.
						</Text>
					</View>
				</ScrollView>
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
		backgroundColor: 'rgba(8,0,46,0.92)',
		borderBottomWidth: 1,
		borderBottomColor: 'rgba(255,255,255,0.08)',
		zIndex: 40,
	},
	headerContent: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		height: 60,
	},
	backBtn: {
		width: 32,
		height: 32,
		borderRadius: 8,
		backgroundColor: 'rgba(255,255,255,0.1)',
		alignItems: 'center',
		justifyContent: 'center',
		marginRight: 12,
	},
	backBtnText: {
		color: '#fff',
		fontSize: 18,
		fontWeight: '700',
	},
	headerTitles: {
		flex: 1,
	},
	headerTitle: {
		fontSize: 15,
		fontWeight: '800',
		color: '#fff',
	},
	headerSubtitle: {
		fontSize: 11,
		color: 'rgba(255,255,255,0.5)',
		fontWeight: '600',
	},
	stripeLogoPlaceholder: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 4,
		backgroundColor: 'rgba(255,255,255,0.1)',
	},
	stripeText: {
		color: '#fff',
		fontSize: 12,
		fontWeight: '900',
		fontStyle: 'italic',
	},
	scrollContent: {
		flexGrow: 1,
	},
	scrollContentSuccess: {
		flexGrow: 1,
		padding: 24
	},
	orderBanner: {
		padding: 24,
		alignItems: 'center',
		backgroundColor: 'rgba(0,0,0,0.2)',
	},
	merchantRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginBottom: 16,
		alignSelf: 'flex-start',
	},
	merchantIcon: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: '#fff',
		alignItems: 'center',
		justifyContent: 'center',
		padding: 4,
	},
	logoMini: {
		width: '100%',
		height: '100%',
	},
	merchantName: {
		fontSize: 14,
		fontWeight: '800',
		color: '#fff',
	},
	merchantUrl: {
		fontSize: 12,
		color: 'rgba(255,255,255,0.5)',
	},
	priceRow: {
		flexDirection: 'row',
		alignItems: 'baseline',
		marginBottom: 4,
	},
	priceCurrency: {
		fontSize: 18,
		fontWeight: '700',
		color: '#fff',
		marginRight: 4,
	},
	priceAmount: {
		fontSize: 36,
		fontWeight: '900',
		color: '#fff',
	},
	itemDetail: {
		fontSize: 14,
		color: 'rgba(255,255,255,0.6)',
		marginBottom: 16,
	},
	trustBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		backgroundColor: 'rgba(16, 185, 129, 0.1)',
		borderWidth: 1,
		borderColor: 'rgba(16, 185, 129, 0.2)',
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 99,
	},
	trustIcon: {
		fontSize: 12,
	},
	trustText: {
		fontSize: 10,
		fontWeight: '900',
		color: '#10B981',
		letterSpacing: 1,
	},
	paymentSheet: {
		flex: 1,
		backgroundColor: 'rgba(255, 255, 255, 0.05)',
		borderTopLeftRadius: 30,
		borderTopRightRadius: 30,
		padding: 24,
		marginTop: -20,
	},
	section: {
		marginBottom: 24,
	},
	label: {
		fontSize: 12,
		fontWeight: '800',
		color: '#6B7280',
		letterSpacing: 1,
		marginBottom: 12,
	},
	fieldLabel: {
		fontSize: 14,
		fontWeight: '600',
		color: '#374151',
		marginBottom: 8,
	},
	input: {
		backgroundColor: '#F9FAFB',
		borderWidth: 1,
		borderColor: '#D1D5DB',
		borderRadius: 8,
		paddingHorizontal: 16,
		paddingVertical: 12,
		fontSize: 15,
		color: '#111827',
	},
	inputGroup: {
		marginBottom: 8,
	},
	dividerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginBottom: 20,
		marginTop: 8,
	},
	divider: {
		flex: 1,
		height: 1,
		backgroundColor: '#E5E7EB',
	},
	dividerText: {
		fontSize: 11,
		fontWeight: '800',
		color: '#9CA3AF',
		letterSpacing: 1,
	},
	cardGroup: {
		borderRadius: 8,
		overflow: 'hidden',
	},
	cardNumberRow: {
		flexDirection: 'row',
		alignItems: 'center',
		position: 'relative',
	},
	cardIcons: {
		position: 'absolute',
		right: 12,
		flexDirection: 'row',
		gap: 4,
	},
	cardIcon: {
		fontSize: 10,
		fontWeight: '900',
		color: '#6B7280',
		backgroundColor: '#E5E7EB',
		paddingHorizontal: 4,
		paddingVertical: 2,
		borderRadius: 4,
	},
	cardExpiryCvcRow: {
		flexDirection: 'row',
	},
	inputNoBottomRadius: {
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: 0,
		width: '100%',
	},
	inputNoTopRadius: {
		borderTopLeftRadius: 0,
		borderTopRightRadius: 0,
	},
	pickerPlaceholder: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	pickerText: {
		fontSize: 15,
		color: '#111827',
	},
	pickerArrow: {
		fontSize: 14,
		color: '#6B7280',
	},
	recoveryNotice: {
		flexDirection: 'row',
		gap: 12,
		backgroundColor: '#FFFBEB',
		borderWidth: 1,
		borderColor: '#FEF3C7',
		borderRadius: 12,
		padding: 16,
		marginBottom: 24,
	},
	recoveryIcon: {
		fontSize: 18,
	},
	recoveryText: {
		flex: 1,
		fontSize: 13,
		color: '#92400E',
		lineHeight: 20,
	},
	btnPayWrap: {
		borderRadius: 14,
		overflow: 'hidden',
		shadowColor: '#EA580C',
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.3,
		shadowRadius: 16,
		elevation: 6,
		marginBottom: 24,
	},
	btnPay: {
		height: 56,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
	},
	btnPayIcon: {
		fontSize: 18,
	},
	btnPayLabel: {
		color: '#fff',
		fontSize: 18,
		fontWeight: '900',
	},
	error: {
		marginTop: 12,
		color: '#F87171',
		fontSize: 14,
		textAlign: 'center',
	},
	securityBadges: {
		alignItems: 'center',
		gap: 8,
		marginBottom: 20,
	},
	securityText: {
		fontSize: 11,
		fontWeight: '700',
		color: '#9CA3AF',
		letterSpacing: 1,
	},
	stripeBranding: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	stripeBrandingText: {
		fontSize: 13,
		color: '#6B7280',
	},
	legalLinks: {
		flexDirection: 'row',
		justifyContent: 'center',
		gap: 12,
		marginBottom: 12,
	},
	legalLinkText: {
		fontSize: 13,
		color: '#3B82F6',
		fontWeight: '600',
	},
	legalDot: {
		color: '#E5E7EB',
	},
	fineprint: {
		fontSize: 11,
		color: '#9CA3AF',
		textAlign: 'center',
		lineHeight: 16,
		paddingHorizontal: 20,
	},
	// Success state styles
	successHeader: {
		alignItems: 'center',
		marginBottom: 30,
		paddingHorizontal: 20,
	},
	successIconCircle: {
		width: 60,
		height: 60,
		borderRadius: 30,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 20,
		shadowColor: '#16A34A',
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 10,
		elevation: 5,
	},
	successCheckmark: {
		color: '#fff',
		fontSize: 32,
		fontWeight: '900',
	},
	successTitle: {
		fontSize: 28,
		fontWeight: '900',
		color: '#fff',
		marginBottom: 10,
		textAlign: 'center',
	},
	successSubtitle: {
		fontSize: 15,
		color: 'rgba(255,255,255,0.7)',
		textAlign: 'center',
		lineHeight: 22,
		marginBottom: 4,
	},
	successCta: {
		fontSize: 15,
		fontWeight: '700',
		color: '#F59E0B',
		textAlign: 'center',
	},
	receiptCard: {
		backgroundColor: 'rgba(255, 255, 255, 0.05)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.1)',
		borderRadius: 18,
		padding: 20,
		marginBottom: 24,
	},
	receiptLabel: {
		fontSize: 11,
		fontWeight: '900',
		color: 'rgba(255,255,255,0.4)',
		letterSpacing: 1,
		marginBottom: 16,
	},
	receiptRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingVertical: 10,
		borderBottomWidth: 1,
		borderBottomColor: 'rgba(255,255,255,0.06)',
	},
	receiptKey: {
		fontSize: 14,
		color: 'rgba(255,255,255,0.5)',
	},
	receiptVal: {
		fontSize: 14,
		fontWeight: '700',
		color: '#fff',
	},
	rulesBox: {
		backgroundColor: 'rgba(124, 58, 237, 0.08)',
		borderWidth: 1,
		borderColor: 'rgba(124, 58, 237, 0.2)',
		borderRadius: 18,
		padding: 20,
		marginBottom: 24,
	},
	rulesHead: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		marginBottom: 16,
	},
	rulesIconMain: {
		fontSize: 18,
	},
	rulesTitle: {
		fontSize: 14,
		fontWeight: '800',
		color: 'rgba(255,255,255,0.8)',
	},
	ruleItem: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginBottom: 12,
	},
	ruleIconWrap: {
		width: 28,
		height: 28,
		borderRadius: 8,
		alignItems: 'center',
		justifyContent: 'center',
	},
	ruleIcon: {
		fontSize: 14,
	},
	ruleText: {
		flex: 1,
		fontSize: 13,
		color: 'rgba(255,255,255,0.6)',
		lineHeight: 18,
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
