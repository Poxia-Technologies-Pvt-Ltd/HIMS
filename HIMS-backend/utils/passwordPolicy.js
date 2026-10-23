// One password policy for every place a password is set (tender #107):
// self-service change, reset link, staff creation and admin resets.

export const PASSWORD_RULE = 'at least 8 characters, with an upper-case letter, a lower-case letter, a number and a symbol';

// null when acceptable, otherwise the reason it is not.
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return `Password must be ${PASSWORD_RULE}.`;
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return `Password must be ${PASSWORD_RULE}.`;
  }
  return null;
}

// Passwords older than this must be changed at the next login. Accounts whose
// password predates password_changed_at (NULL) are not forced until changed once.
export const PASSWORD_MAX_AGE_DAYS = Number(process.env.PASSWORD_MAX_AGE_DAYS) || 90;

export const passwordExpired = (changedAt) =>
  !!changedAt && Date.now() - new Date(changedAt).getTime() > PASSWORD_MAX_AGE_DAYS * 86400000;
