import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  MIN_AGE,
  checkEmailVerified,
  completeRegistration,
  formatPhone,
  isValidPhone,
  normalizePhone,
  registerDeviceToken,
  registerEmail,
  requestSmsCode,
  verifySmsCode,
  type AuthResult,
  type LoginStep,
} from '@/api/auth';
import { setAuthToken } from '@/api/client';
import { useSession } from '@/api/session';
import { LoginFileImport, SavedAccounts } from '@/components/accounts/sign-in-options';
import {
  FeatureList,
  ProjectLinks,
  Welcome,
  WelcomeFooter,
} from '@/components/accounts/welcome';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Breakpoints, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WORKER_URL } from '@/lib/worker';

const EMAIL_POLL_MS = 3000;

/** The two columns side by side: the introduction, then the form. */
const WIDE_MAX_WIDTH = 1040;

const STEP_COPY: Record<LoginStep, { title: string; body: string }> = {
  phone: {
    title: 'Sign in',
    body: 'Use your Yik Yak account. Accounts are tied to a US phone number, and Yik Yak texts it a code.',
  },
  code: { title: 'Enter your code', body: 'Check your messages for a 6-character code.' },
  age: { title: 'How old are you?', body: `You need to be at least ${MIN_AGE}.` },
  email: {
    title: 'School email',
    body: 'Only needed to join your school feed. Interest communities work without it.',
  },
  emailPending: {
    title: 'Check your inbox',
    body: 'Click the link we sent, and this page will continue on its own.',
  },
};

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { status, signIn, deviceId } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= Breakpoints.sidebar;

  const [step, setStep] = useState<LoginStep>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The token is held here rather than committed through `signIn` until the flow
  // finishes — committing early would flip the session to authenticated and the
  // redirect below would fire mid-flow. Intermediate authenticated calls get the
  // token via `setAuthToken` instead.
  const pendingAuth = useRef<AuthResult | null>(null);

  const finish = useCallback(
    async (result: AuthResult) => {
      await signIn(result);
      router.replace('/');
    },
    [router, signIn],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, []);

  const submitPhone = () =>
    run(async () => {
      await requestSmsCode(phone);
      setStep('code');
    });

  const submitCode = () =>
    run(async () => {
      const outcome = await verifySmsCode(phone, code);
      if (outcome.kind === 'authenticated') {
        await finish(outcome);
        return;
      }
      if (outcome.kind === 'needsAge') {
        setRegistrationId(outcome.registrationId);
        setStep('age');
        return;
      }
      pendingAuth.current = { token: outcome.token, userId: outcome.userId };
      setAuthToken(outcome.token);
      setStep('email');
    });

  const submitAge = () =>
    run(async () => {
      if (!registrationId) throw new Error('Missing registration id — start over.');
      const result = await completeRegistration(Number(age), registrationId);
      pendingAuth.current = result;
      setAuthToken(result.token);
      if (deviceId) {
        // Best-effort: offsides does this here, but a failure shouldn't strand
        // someone mid-signup. Phase 6 verifies the API accepts our device id.
        try {
          await registerDeviceToken(deviceId);
        } catch {
          /* non-fatal */
        }
      }
      setStep('email');
    });

  const submitEmail = () =>
    run(async () => {
      await registerEmail(email);
      setStep('emailPending');
    });

  const skipEmail = () =>
    run(async () => {
      const pending = pendingAuth.current;
      if (!pending) throw new Error('No session to continue with — start over.');
      await finish(pending);
    });

  const checkNow = useCallback(
    () =>
      run(async () => {
        const result = await checkEmailVerified();
        if (result) await finish(result);
        else setError('Not verified yet — click the link in the email, then try again.');
      }),
    [finish, run],
  );

  // Poll while waiting on the emailed link.
  useEffect(() => {
    if (step !== 'emailPending') return;
    const id = setInterval(() => {
      void (async () => {
        try {
          const result = await checkEmailVerified();
          if (result) await finish(result);
        } catch {
          /* keep polling */
        }
      })();
    }, EMAIL_POLL_MS);
    return () => clearInterval(id);
  }, [step, finish]);

  if (status === 'authenticated') return <Redirect href="/" />;

  const copy = STEP_COPY[step];

  /*
    Wide: the introduction on the left, the form on the right, both in view.
    Narrow: the introduction's first lines, then the form, so it is on the
    first screen of a phone, then the rest of the introduction under it.
  */
  const intro = (
    <>
      <FeatureList />
      <ProjectLinks />
    </>
  );

  return (
    <Screen maxWidth={wide ? WIDE_MAX_WIDTH : Layout.feedMaxWidth} centered>
      <View style={wide ? styles.columns : styles.stack}>
        <View style={wide ? styles.introColumn : styles.stack}>
          <Welcome />
          {wide ? intro : null}
        </View>

        <View style={wide ? styles.formColumn : styles.stack}>
          {step === 'phone' ? <SavedAccounts /> : null}
          <View
            style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.cardHead}>
              <ThemedText type="heading">{copy.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {copy.body}
              </ThemedText>
            </View>
            {step === 'phone' ? (
              <>
                <TextField
                  label="Phone number"
                  value={formatPhone(phone)}
                  onChangeText={(t) => setPhone(normalizePhone(t))}
                  placeholder="(555) 555-5555"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  hint="US numbers only."
                  error={error}
                />
                <Button
                  label="Send code"
                  onPress={submitPhone}
                  loading={busy}
                  disabled={!isValidPhone(phone)}
                  fullWidth
                />
                <LoginFileImport />
              </>
            ) : null}

            {step === 'code' ? (
              <>
                <TextField
                  label="Verification code"
                  value={code}
                  onChangeText={setCode}
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={8}
                  error={error}
                />
                <Button
                  label="Verify"
                  onPress={submitCode}
                  loading={busy}
                  disabled={code.trim().length < 4}
                  fullWidth
                />
                <Button
                  label="Use a different number"
                  variant="ghost"
                  onPress={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}
                  fullWidth
                />
              </>
            ) : null}

            {step === 'age' ? (
              <>
                <TextField
                  label="Age"
                  value={age}
                  onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 3))}
                  placeholder="18"
                  keyboardType="number-pad"
                  maxLength={3}
                  error={error}
                />
                <Button
                  label="Continue"
                  onPress={submitAge}
                  loading={busy}
                  disabled={Number(age) < MIN_AGE}
                  fullWidth
                />
              </>
            ) : null}

            {step === 'email' ? (
              <>
                <TextField
                  label="School email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@school.edu"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  error={error}
                />
                <Button
                  label="Send verification"
                  onPress={submitEmail}
                  loading={busy}
                  disabled={!email.includes('@')}
                  fullWidth
                />
                <Button label="Skip for now" variant="ghost" onPress={skipEmail} fullWidth />
              </>
            ) : null}

            {step === 'emailPending' ? (
              <>
                {error ? (
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {error}
                  </ThemedText>
                ) : null}
                <Button label="I've verified it" onPress={checkNow} loading={busy} fullWidth />
                <Button label="Skip for now" variant="ghost" onPress={skipEmail} fullWidth />
              </>
            ) : null}
          </View>
          <ThemedText type="caption" themeColor="textTertiary">
            {WORKER_URL
              ? "Sign-in goes straight from this browser to Yik Yak. Your login stays in this browser. Besides Yik Yak, only webyak's media relay sees it, to upload images and load video thumbnails, and it keeps nothing."
              : 'Sign-in goes straight from this browser to Yik Yak. Your login stays in this browser and is sent to Yik Yak alone.'}
          </ThemedText>
        </View>

        {wide ? null : intro}
      </View>

      <WelcomeFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.six,
    paddingVertical: Spacing.four,
  },
  introColumn: {
    flex: 1,
    gap: Spacing.five,
  },
  formColumn: {
    width: 400,
    gap: Spacing.three,
  },
  stack: {
    gap: Spacing.four,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardHead: {
    gap: Spacing.one,
  },
});
