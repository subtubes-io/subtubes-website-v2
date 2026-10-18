// The git remote as it is stored and shown: no credentials, no query, no fragment. The app removes credentials before it sends one;
// this does it again because the app is not trusted.
export function sanitizeRemote(remote: string | null): string | null {
  if (remote === null) return null;

  // scp-style: user@host:path. Only the conventional "git" user is kept.
  const scp = /^([\w.-]+)@([\w.-]+):(.+)$/.exec(remote);
  if (scp && !remote.includes("://")) return scp[1] === "git" ? remote : `${scp[2]}:${scp[3]}`;

  let url: URL;
  try {
    url = new URL(remote);
  } catch {
    return null;
  }
  const keepGitUser = url.protocol === "ssh:" && url.username === "git" && url.password === "";
  if (!keepGitUser) url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
