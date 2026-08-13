import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

// The lint scripts now point ESLint at directories rather than at `src`, so
// generated and built output has to be named or a local `pnpm lint` grades the
// bundler's work instead of ours.
const ignores = [
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.vite/**",
  "apps/web/dev-dist/**",
];

// Type-aware linting costs a TypeScript program per run, so it is pointed at the
// two Node services rather than at everything. They are also where it pays:
// both lean on `void somePromise` and fire-and-forget background work, which is
// what no-floating-promises and no-misused-promises exist to police.
//
// It also gives `pnpm lint` the same prerequisite `pnpm typecheck` has: both
// services import types from @cataloggy/shared, and until that package is built
// those imports resolve to nothing. TypeScript calls the result an `error` type
// that behaves like `any`, which rules such as no-redundant-type-constituents
// then report against source that is perfectly fine — so the root lint script
// builds shared first. Without that the failure only appears on a clean
// checkout, since any earlier local build leaves dist/ lying around.
const typeCheckedPackages = ["apps/api/**/*.ts", "apps/addon/**/*.ts"];

export default [
  { ignores },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    }
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-console": "off"
    }
  },

  // ─── Type-aware rules for the API and the addon ───

  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typeCheckedPackages
  })),
  {
    files: typeCheckedPackages,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Off rather than warned, because each of these is a disagreement with a
      // convention the two services use everywhere — left on `warn` they would
      // print several hundred lines on every run and train everyone to scroll
      // past the output.
      //
      // Fastify route handlers are declared `async` whether or not they await:
      // the framework's contract is that a handler returns the reply body or a
      // promise of it, and the signature is uniform across ~200 routes.
      "@typescript-eslint/require-await": "off",
      // The `no-unsafe-*` family fires wherever `any` reaches an expression,
      // which here is almost entirely Fastify's request generics and the
      // `unknown` that JSON.parse and request bodies start as. Turning these on
      // is a typing campaign — narrow the request/response generics, then flip
      // them back one at a time — not a lint setting.
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Warned rather than errored because the ~30 hits are not one thing. Most
      // are dead casts on values TypeScript already narrows and should simply
      // go. A handful are `request.profileId!`, where the receiver is a Prisma
      // `where`/`data` object that does accept `undefined` — and accepting it is
      // exactly the hazard, since Prisma reads an `undefined` profileId as "no
      // filter" rather than as "no profile" (see the note on WatchEventInput in
      // lib/types.ts). Removing those assertions is how a profile-scoped query
      // quietly becomes a global one, so each site wants a decision, not --fix.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn"
    }
  },

  // ─── The web app ───

  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  // Both plugin configs ship without a `files` key, which in flat config means
  // "every file" — including the API's .ts and the repo's build scripts. Scoped
  // here to the one app that renders React.
  //
  // `reactHooks.configs.flat` rather than `.configs` — the top-level names are
  // still the eslintrc shape, which flat config rejects with a "plugins must be
  // an object" error that never mentions React.
  // ─── Adoption backlog ───
  //
  // Both plugins are going in on a codebase that has never been linted by them,
  // so they arrive with findings. `rules-of-hooks` and `exhaustive-deps` — the
  // two rules this was actually about — are clean and keep their recommended
  // severity, so a new violation of either shows up immediately. The rules
  // listed as `warn` below still have open findings: visible on every run,
  // not failing the build. Promote each back as its findings reach zero.
  //
  // The severities are merged into the plugin's own config object rather than
  // set in a later one. A config object may only set a rule for files it also
  // registers the plugin for, and jsx-a11y is registered for JSX files only —
  // a separate override block spanning `.ts` as well fails the whole run with
  // "could not find plugin".
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      // react-hooks v7 bundles the React Compiler rules, a much wider net than
      // the two above: `refs` rejects the latest-ref pattern (`ref.current =
      // value` during render) this codebase uses deliberately in useCachedState
      // and elsewhere, and `set-state-in-effect` rejects the load-then-setState
      // shape every page here is built on. Clearing those is a React Compiler
      // migration, not a lint fix.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/globals": "warn"
    }
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["apps/web/**/*.{jsx,tsx}"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The a11y findings split three ways and want a human on each: genuine
      // gaps (a "Year" label tied to no control), rule/markup disagreements
      // that want a rule option rather than a code change
      // (`label-has-associated-control` not seeing through this codebase's
      // label nesting), and deliberate decisions the rule cannot see — the
      // `tabIndex` on the stats chart is there *because* of WCAG 1.4.10, and
      // autofocus inside a modal dialog is the recommended behaviour rather
      // than a violation of it. Warned rather than silenced, so the list stays
      // in front of whoever picks up the next accessibility pass.
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/interactive-supports-focus": "warn"
    }
  }
];
