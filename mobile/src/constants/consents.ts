/**
 * App consent copy — edit `consents.json` to change text shown in the UI.
 * Keys must stay `consent_1`, `consent_2`, `consent_3` unless you update HomeScreen logic.
 */
import consentsJson from './consents.json';

export type ConsentKey = 'consent_1' | 'consent_2' | 'consent_3';

export const CONSENT_KEYS: readonly ConsentKey[] = ['consent_1', 'consent_2', 'consent_3'];

export const CONSENTS: Record<ConsentKey, string> = {
  consent_1: consentsJson.consent_1,
  consent_2: consentsJson.consent_2,
  consent_3: consentsJson.consent_3,
};
