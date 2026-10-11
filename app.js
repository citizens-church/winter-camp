import {config} from './config.js';
import {configured, validate, sendInterest} from './form-core.js';
const form = document.querySelector('#interest-form');
const status = document.querySelector('#form-status');
const notice = document.querySelector('#setup-notice');
const submit = form.querySelector('[type=submit]');
let token = '', widgetId, sending = false, startedAt = Date.now(), submissionId = crypto.randomUUID(), previousPayload = '';
function announce(message, focus = false) { status.textContent = message; if (focus) status.focus(); }
function clearErrors() { for (const el of form.querySelectorAll('[aria-invalid]')) { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); } for (const el of form.querySelectorAll('.field-error')) el.textContent = ''; }
function enableForm() { for (const el of form.querySelectorAll('input,fieldset')) el.disabled = false; submit.disabled = false; notice.hidden = true; }
if (configured(config)) {
  notice.textContent = 'Loading secure interest form…';
  window.onCampTurnstileReady = () => {
    try {
      widgetId = window.turnstile.render('#turnstile', {
        sitekey: config.turnstileSiteKey, action: 'winter-camp-interest', theme: 'light', size: 'compact',
        callback: value => { token = value; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; announce('Spam protection couldn’t load. Please refresh the page and try again.'); }
      });
      enableForm();
    } catch { notice.textContent = 'The secure form couldn’t load. Please refresh the page and try again.'; }
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onCampTurnstileReady&render=explicit'; script.async = true; script.defer = true;
  script.onerror = () => { notice.textContent = 'The secure form couldn’t load. Please check your connection and refresh the page.'; };
  document.head.append(script);
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !configured(config)) return;
  clearErrors();
  const data = new FormData(form);
  const values = {parentName: String(data.get('parentName') || '').trim(), email: String(data.get('email') || '').trim(), phone: String(data.get('phone') || '').trim(), interest: String(data.get('interest') || ''), consent: data.get('consent') === 'on', website: String(data.get('website') || '')};
  const errors = validate(values);
  if (Object.keys(errors).length) {
    for (const [key, message] of Object.entries(errors)) { const field = document.getElementById(key); const error = document.getElementById(`${key}-error`); if (field && error) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', error.id); error.textContent = message; } }
    announce('Please check the highlighted fields.'); form.querySelector('[aria-invalid=true]')?.focus(); return;
  }
  if (!token) { announce('Please complete the spam-protection check before sending.', true); return; }
  const fingerprint = JSON.stringify(values);
  if (previousPayload && previousPayload !== fingerprint) submissionId = crypto.randomUUID();
  previousPayload = fingerprint;
  sending = true; submit.disabled = true; form.setAttribute('aria-busy','true'); announce('Sending your interest…');
  try {
    await sendInterest(config.endpoint, {...values, startedAt, submissionId, turnstileToken: token});
    form.reset(); clearErrors(); announce('You’re on the interest list! Citizens Church has received your details for Winter Camp follow-up. This is not a camp reservation.', true);
    submissionId = crypto.randomUUID(); previousPayload = ''; startedAt = Date.now();
  } catch (error) { announce(error.message, true); }
  finally { token = ''; if (widgetId !== undefined) window.turnstile?.reset(widgetId); sending = false; submit.disabled = false; form.removeAttribute('aria-busy'); }
});
