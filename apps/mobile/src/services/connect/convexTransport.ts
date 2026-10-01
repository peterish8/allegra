import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';

import {
  createConvexTransport,
  type ConvexWireClient,
  type DevelopmentTraceBuffer
} from '../../../../../packages/connect/src/index';

/** Binds the package-owned V2 transport to the mobile Convex client. */
export function createMobileConnectTransport(
  client: ConvexReactClient,
  trace?: DevelopmentTraceBuffer
) {
  const binding: ConvexWireClient = {
    mutation(name, args) {
      const reference = makeFunctionReference<'mutation', Record<string, unknown>, unknown>(name);
      return client.mutation(reference, args);
    },
    watchQuery(name, args) {
      const reference = makeFunctionReference<'query', Record<string, unknown>, unknown>(name);
      const watch = client.watchQuery(reference, args);
      return {
        onUpdate: callback => watch.onUpdate(callback),
        current: () => watch.localQueryResult()
      };
    }
  };
  return createConvexTransport(binding, trace ? { trace } : undefined);
}
