function validEmail(email) {
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(email)) return false;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

export function configured(config) {
  try { const u = new URL(config.endpoint); return u.protocol === 'https:' && !u.username && !u.password && u.pathname.endsWith('/interest') && Boolean(config.turnstileSiteKey?.trim()); } catch { return false; }
}
export function validate(values) {
  const errors = {};
  if (!values.parentName || values.parentName.length > 120 || /[\u0000-\u001f\u007f]/.test(values.parentName)) errors.parentName = 'Please enter your name (120 characters or fewer).';
  if (!values.email || !validEmail(values.email)) errors.email = 'Please enter a valid email address.';
  if (values.phone && (values.phone.length > 32 || !/^[+\d ().-]{7,32}$/.test(values.phone))) errors.phone = 'Please enter a valid phone number, or leave this blank.';
  if (!values.consent) errors.consent = 'Please confirm your age and permission to contact you.';
  if (!['interested', 'questions'].includes(values.interest)) errors.interest = 'Please choose an interest option.';
  return errors;
}
export async function sendInterest(endpoint, payload, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      if (body?.error === 'validation_failed') throw new Error('Please check your contact details and consent. If this page has been open for a long time, refresh it and try again.');
      if (body?.error === 'verification_failed') throw new Error('The spam-protection check expired. Please complete it again and retry.');
      if (response.status === 429) throw new Error('Too many attempts. Please wait a few minutes before trying again.');
      throw new Error('We couldn’t confirm your submission. Your details are still here. Please try again.');
    }
    return true;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The connection timed out. We couldn’t confirm your submission. Please try again.');
    if (error instanceof TypeError) throw new Error('We couldn’t connect. Check your internet connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
