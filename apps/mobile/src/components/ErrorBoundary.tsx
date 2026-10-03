/**
 * Keeps one broken view from taking the whole app down.
 *
 * In a release build a render error with no boundary above it closes the app.
 * Wrapped around a part of the screen, a failure there shows `fallback` (or
 * nothing) and the rest keeps working — music keeps playing. `resetKey`
 * clears the error when it changes (another song, another screen).
 */
import React from 'react';
import * as Sentry from '@sentry/react-native';

interface Props {
  children: React.ReactNode;
  /** Shown in place of the children after a failure; `retry` renders them again. */
  fallback?: (retry: () => void) => React.ReactNode;
  /** Any change clears a caught error. */
  resetKey?: unknown;
  /** Where it failed, for the crash report. */
  name: string;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      Sentry.captureException(error, { tags: { boundary: this.props.name }, extra: { componentStack: info.componentStack } });
    } catch {
      // Reporting must never throw from the boundary itself.
    }
    if (__DEV__) console.warn(`[ErrorBoundary:${this.props.name}]`, error);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  private retry = (): void => this.setState({ failed: false });

  render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback ? this.props.fallback(this.retry) : null;
    return this.props.children;
  }
}

export default ErrorBoundary;
