# SimulaEdu Static Admin

This is the standalone static admin for SimulaEdu.
It is designed to be deployable as raw static files, for example on GitHub Pages under `simulaedu.icarodlima.com`, while all privileged reads and writes go through Supabase Edge Functions.

## Architecture

```
Browser static HTML
  ↓ Google OAuth session via Supabase Auth
Supabase Edge Function: admin-api
  ↓ secret key, server-side validation
Postgres tables
```

The browser only receives the public Supabase URL and publishable key. It never receives the secret key and never sends trusted `app_id` values. The Edge Function resolves the app from the URL slug and checks the signed-in editor email against `app_editors` before touching content.

## Local setup

1. Copy `src/config.example.js` into `src/config.js`.
2. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
3. Serve the folder with any static server:

```sh
npx serve .
```

## Supabase setup

Deploy the function:

```sh
supabase functions deploy admin-api
```

No custom Supabase key secrets are required for the deployed Edge Function. Supabase automatically provides `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and `SUPABASE_SECRET_KEYS` to functions.

For local function development, add fallback values to `supabase/functions/.env` if needed:

```sh
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

Google Sign-In must be enabled in Supabase Auth. Add the static admin URL to the allowed redirect URLs.

## Current scope

The static admin can:

- Sign in with Google.
- List apps the editor can access.
- Create, edit, delete, and reorder exam types.
- Create, edit, delete, and reorder themes grouped by exam type.
- Create, edit, delete, and filter questions.
- Edit theme/question relationships by question number.
- Publish a versioned JSON snapshot into `published_content_versions`.

