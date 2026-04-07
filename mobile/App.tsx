import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList } from './src/navigation/types';
import { HomeScreen } from './src/screens/HomeScreen';
import { LandingScreen } from './src/screens/LandingScreen';
import { SplashScreen } from './src/screens/SplashScreen';
import { InactiveAccountScreen } from './src/screens/InactiveAccountScreen';
import { QuizHomeScreen } from './src/screens/QuizHomeScreen';
import { QuizCompleteScreen } from './src/screens/QuizCompleteScreen';
import { QuizPlayScreen } from './src/screens/QuizPlayScreen';
import { QuizPrepareScreen } from './src/screens/QuizPrepareScreen';

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
            name="Landing"
            component={LandingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="QuizHome"
            component={QuizHomeScreen}
            options={{ title: 'Quiz', headerShown: true, gestureEnabled: false }}
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
            name="InactiveAccount"
            component={InactiveAccountScreen}
            options={{ title: 'Account', headerShown: true }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
