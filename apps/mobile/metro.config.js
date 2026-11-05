const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The app lives in the Allegra monorepo but is not a root workspace: it imports
// shared code from ../../packages (the `@shared/*` path in tsconfig.json) while
// every npm package must come from THIS app's node_modules. The repo root has
// its own node_modules (the web's React, Convex); resolving into it would put
// two copies of React in the bundle — which is why packages/ code imports no npm
// packages at all (tests/infra asserts it).
const repoRoot = path.resolve(__dirname, '../..');
config.watchFolders = [...(config.watchFolders ?? []), path.join(repoRoot, 'packages')];

// Increase timeout for slower connections
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Increase timeout to 5 minutes for slow networks
      req.setTimeout(300000);
      res.setTimeout(300000);
      return middleware(req, res, next);
    };
  },
};

// Increase resolver timeout
config.resolver = {
  ...config.resolver,
  // Gradle replaces these directories while compiling. They contain no Metro sources.
  blockList: /[/\\]node_modules[/\\].*[/\\]android[/\\](?:build|\.cxx)[/\\].*/,
  resolverMainFields: ['react-native', 'browser', 'main'],
  nodeModulesPaths: [path.join(__dirname, 'node_modules')],
};

// Sentry ships its web session replay, its user feedback widget and server-only AI modules in the same package. None
// of them runs here (replay stays off; bug reports go through services/feedback), so they stay out of the bundle.
const {
  withSentryExcludeServerOnlyResolver,
  withSentryFeedbackResolver,
  withSentryResolver,
} = require('@sentry/react-native/metro');

const sentryConfig = withSentryExcludeServerOnlyResolver(withSentryFeedbackResolver(withSentryResolver(config, false), false));

// Sentry stubs `@sentry/browser`'s feedbackSync/feedbackAsync wrappers only when the importing path contains
// "@sentry/browser" with forward slashes. On Windows the path has backslashes, the wrappers stay in, and they
// call the stubbed feedback package at startup: a bundle built on Windows crashed on launch with
// "undefined is not a function" (CI builds on Linux were fine). Normalise the path and stub them here too.
const SENTRY_FEEDBACK_WRAPPER = /\/feedback(Sync|Async)/;
const sentryResolve = sentryConfig.resolver.resolveRequest;
sentryConfig.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  const origin = (context.originModulePath ?? '').replace(/\\/g, '/');
  if ((platform === 'android' || platform === 'ios') && origin.includes('/@sentry/browser/') && SENTRY_FEEDBACK_WRAPPER.test(moduleName)) {
    return { type: 'empty' };
  }
  return sentryResolve ? sentryResolve(context, moduleName, platform, ...rest) : context.resolveRequest(context, moduleName, platform);
};

module.exports = sentryConfig;
