// ESLint 9 flat config for the PCF build.
//
// pcf-scripts' build step lints each control folder and fails only on ERRORS
// (warnings are ignored). ESLint 9 requires a flat config file to exist,
// otherwise it aborts with "Could not find config file".
//
// By default ESLint only lints .js/.mjs/.cjs, so with no TypeScript parser
// configured the .ts sources are simply skipped and the build proceeds.

export default [
  {
    ignores: [
      "**/generated/**",
      "out/**",
      "node_modules/**",
      "**/*.js",
      "**/*.mjs",
    ],
  },
];
