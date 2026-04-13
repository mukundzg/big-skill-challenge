import { fetchConsentStatus } from '../api/auth';
import { hasAcceptedConsents, markConsentsAccepted } from './consentStorage';

/**
 * True if the user should go to Dashboard (consent already recorded on server or cached locally).
 * Syncs local cache when the server reports consent.
 */
export async function shouldSkipConsentScreen(email: string): Promise<boolean> {
  try {
    const { has_consent } = await fetchConsentStatus(email);
    if (has_consent) {
      await markConsentsAccepted(email);
    }
    return has_consent;
  } catch {
    return hasAcceptedConsents(email);
  }
}
