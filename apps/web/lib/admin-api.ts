export class AdminSessionExpiredError extends Error {
  constructor() {
    super('Your admin session expired. Redirecting to sign in.');
    this.name = 'AdminSessionExpiredError';
  }
}

type AdminFetchDependencies = {
  fetcher?: typeof fetch;
  currentLocation?: () => { pathname: string; search: string };
  onAuthenticationRequired?: (path: string) => void;
};

export function adminSignInPath(pathname: string, search = ''): string {
  const returnTo = pathname.startsWith('/admin') ? `${pathname}${search}` : '/admin';
  return `/admin/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function adminApiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  dependencies: AdminFetchDependencies = {},
): Promise<Response> {
  const response = await (dependencies.fetcher ?? fetch)(input, init);
  if (response.status !== 401) return response;

  const location = (dependencies.currentLocation ?? browserLocation)();
  const path = adminSignInPath(location.pathname, location.search);
  (dependencies.onAuthenticationRequired ?? redirectBrowser)(path);
  throw new AdminSessionExpiredError();
}

function browserLocation(): { pathname: string; search: string } {
  return { pathname: window.location.pathname, search: window.location.search };
}

function redirectBrowser(path: string): void {
  window.location.assign(path);
}
