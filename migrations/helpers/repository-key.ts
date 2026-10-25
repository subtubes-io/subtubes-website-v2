// Which repository a git remote is, as one string the desktop app and this website can compare: `host/owner/repo`.
//
// https://GitHub.com/Acme/Payments.git, git@github.com:acme/payments.git and ssh://git@github.com:22/acme/payments all come to
// `github.com/acme/payments`. The scheme, the user (and any password), the port, a trailing `.git` or slash and the case do not make another
// repository, so they are not part of the key. A remote that is not an address of that shape has no key.
//
// This rule is written twice, here and in the desktop app (shared/repositoryKey.ts), and both are tested against the same vectors
// (tests/fixtures/repository-key-vectors.json is the desktop's shared/fixtures/repository-key-vectors.json): if they ever disagree, a report is
// filed where its project cannot find it. Change one, change the other, copy the vectors.

const MAX_KEY = 300;
const SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

// What a key looks like, for a query or a body that names one.
export const REPOSITORY_KEY_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\/[a-z0-9][a-z0-9._~-]*){2,}$/;

export function repositoryKey(remote: string): string | null {
  const text = remote.trim();
  if (text === "" || /\s/.test(text)) return null;

  let host: string;
  let path: string;
  // scp-style: user@host:owner/repo (no scheme, a colon where a port or a path would start).
  const scp = !text.includes("://") ? /^(?:[^@/:]+@)?([^:/@]+):(?!\d+(?:\/|$))(.+)$/.exec(text) : null;
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (!["http:", "https:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(url.protocol)) return null;
    host = url.hostname;
    path = url.pathname;
  }

  host = host.toLowerCase();
  if (!HOST.test(host)) return null;
  const segments = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase()
    .split("/");
  if (segments.length < 2 || !segments.every((segment) => SEGMENT.test(segment))) return null;
  const key = `${host}/${segments.join("/")}`;
  return key.length <= MAX_KEY ? key : null;
}
