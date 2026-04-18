export interface LoginPageOptions {
  actionUrl: string;
  clientName?: string | undefined;
  error?: string | undefined;
}

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderLoginPage(opts: LoginPageOptions): string {
  const client = opts.clientName
    ? `<p>Authorizing <strong>${escape(opts.clientName)}</strong>.</p>`
    : "";
  const err = opts.error
    ? `<p class="error" role="alert">${escape(opts.error)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>habit-mcp &middot; sign in</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body{font-family:system-ui,sans-serif;background:#0b0c10;color:#e6e8eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    form{background:#14171c;padding:2rem 2.25rem;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.4);width:100%;max-width:22rem}
    h1{margin:0 0 .25rem;font-size:1.25rem}
    p{color:#9aa0a6;font-size:.9rem;margin:.25rem 0 1rem}
    label{display:block;font-size:.85rem;margin-bottom:.25rem;color:#c5cad1}
    input{width:100%;box-sizing:border-box;padding:.6rem .75rem;border-radius:8px;border:1px solid #2b2f36;background:#0b0c10;color:#fff;font-size:1rem}
    button{margin-top:1rem;width:100%;padding:.65rem;border-radius:8px;border:0;background:#3b82f6;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}
    button:hover{background:#2563eb}
    .error{color:#f87171}
  </style>
</head>
<body>
  <form method="post" action="${escape(opts.actionUrl)}">
    <h1>habit-mcp</h1>
    <p>Sign in to connect this habit tracker.</p>
    ${client}
    ${err}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}
