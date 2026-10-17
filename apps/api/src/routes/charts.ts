import { Router } from 'express';

import type { TopChartService } from '../services/topChart.js';
import { queryString, sendSuccess } from './common.js';

const TOP_CHART_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=21600';

export function chartsRouter(topChart: Pick<TopChartService, 'get'>): Router {
  const router = Router();

  router.get('/charts/top', async (request, response) => {
    const storefront = (queryString(request.query.country) ?? 'IN').toUpperCase();
    if (!/^[A-Z]{2}$/.test(storefront)) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const chart = await topChart.get(storefront);
    // A chart that could not be built is not cached at the edge, so the next visit tries again.
    response.setHeader('Cache-Control', chart.available ? TOP_CHART_CACHE_CONTROL : 'no-store');
    sendSuccess(response, chart);
  });

  return router;
}
