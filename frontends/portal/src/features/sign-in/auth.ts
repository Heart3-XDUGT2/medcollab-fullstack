export type SignInCredentials = { identifier: string; password: string };
export type SignInErrors = { identifier?: string; password?: string };

export interface SignInAdapter {
  signIn(credentials: SignInCredentials): Promise<{ status: 'unconfigured' }>;
}

export const unconfiguredSignInAdapter: SignInAdapter = {
  async signIn() {
    return { status: 'unconfigured' };
  },
};

export function validateSignIn({ identifier, password }: SignInCredentials): SignInErrors {
  const account = identifier.trim();
  const errors: SignInErrors = {};
  if (!account) {
    errors.identifier = '请填写邮箱或账号';
  } else if (account.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
    errors.identifier = '请填写有效的邮箱地址';
  } else if (/\s/.test(account)) {
    errors.identifier = '账号不能包含空格';
  }
  if (!password) errors.password = '请填写密码';
  return errors;
}
