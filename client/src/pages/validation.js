// Mirrors the server's password rules (the server remains the authority).
export const passwordRules = {
  required: 'Password is required',
  minLength: { value: 10, message: 'At least 10 characters' },
  maxLength: { value: 72, message: 'At most 72 characters' },
  validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Must contain a letter and a digit',
};

export const emailRules = {
  required: 'Email is required',
  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
};
