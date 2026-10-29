# Deployment

## Local preview

Use Node.js 20 or newer.

1. Run npm start.
2. Open http://127.0.0.1:4173.
3. Run npm run check to run syntax checks and the automated tests.

The server binds to 127.0.0.1 by default and intentionally does not log URLs. Do not expose the preview server on a public interface unless you understand the risks.

## GitHub Pages

The workflow lives at .github/workflows/pages.yml and is intentionally manual so a repository with Pages disabled does not generate a failing deployment on every push.

One-time setup, performed by the repository owner:

1. Open FAHTHIZ/Umbra on GitHub.
2. Go to Settings, then Pages.
3. Under Build and deployment, select GitHub Actions as the source.
4. Open the Actions tab, select Deploy Umbrella directory, then Run workflow on main.
5. When the deployment job succeeds, open the URL shown in the workflow's deployment environment.

The GitHub Actions token available to this workflow cannot create the repository's Pages site in its current permission context. The owner must enable Pages in repository settings first. No source code or secret is needed to do this.

## Deployment caveat

GitHub Pages is a public static hosting service. Its infrastructure can observe ordinary requests to the published website. The client makes no analytics calls, but a hosted site cannot hide visitors from its own hosting provider. For stronger separation, run the app locally and use the trusted Tor Browser separately for onion navigation.
