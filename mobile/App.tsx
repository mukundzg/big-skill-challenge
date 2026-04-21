import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from './src/navigation/types';
import { SplashScreen } from './src/screens/SplashScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { InactiveAccountScreen } from './src/screens/InactiveAccountScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ShortlistResultScreen } from './src/screens/ShortlistResultScreen';
import { QuizCompleteScreen } from './src/screens/QuizCompleteScreen';
import { QuizCreativeScreen } from './src/screens/QuizCreativeScreen';
import { QuizEntryAcceptedScreen } from './src/screens/QuizEntryAcceptedScreen';
import { QuizIncorrectScreen } from './src/screens/QuizIncorrectScreen';
import { QuizPlayScreen } from './src/screens/QuizPlayScreen';
import { QuizPrepareScreen } from './src/screens/QuizPrepareScreen';
import { QuizTimeoutScreen } from './src/screens/QuizTimeoutScreen';
import { Consent } from './src/screens/Consent';
import { PaymentScreen } from './src/screens/PaymentScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: '#f4f4f5' },
            headerTintColor: '#18181b',
            contentStyle: { backgroundColor: '#f4f4f5' },
          }}
        >
          <Stack.Screen
            name="Splash"
            component={SplashScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Consent"
            component={Consent}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Payment"
            component={PaymentScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{ title: 'Dashboard', headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="ShortlistResult"
            component={ShortlistResultScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="QuizPrepare"
            component={QuizPrepareScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizPlay"
            component={QuizPlayScreen}
            options={{ title: 'Question', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizComplete"
            component={QuizCompleteScreen}
            options={{ title: 'Complete', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizCreative"
            component={QuizCreativeScreen}
            options={{ title: 'Creative Submission', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizEntryAccepted"
            component={QuizEntryAcceptedScreen}
            options={{ title: 'Entry Accepted', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizIncorrect"
            component={QuizIncorrectScreen}
            options={{ title: 'Incorrect Answer', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizTimeout"
            component={QuizTimeoutScreen}
            options={{ title: 'Time Expired', headerShown: true, gestureEnabled: false }}
          />
          <Stack.Screen
            name="InactiveAccount"
            component={InactiveAccountScreen}
            options={{ title: 'Account', headerShown: true }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
