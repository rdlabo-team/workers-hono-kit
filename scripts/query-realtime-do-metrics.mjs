#!/usr/bin/env node
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  throw new Error('CLOUDFLARE_API_TOKEN (Account Analytics:Read) is required');
}

const namespace = process.argv[2] ?? process.env.REALTIME_DO_CLASS;
if (!namespace) {
  throw new Error('Durable Object class name is required as argv[2] or REALTIME_DO_CLASS');
}
const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountTag) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
}
const since = process.env.REALTIME_METRICS_SINCE ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const query = `query RealtimeMetrics($accountTag: string!, $since: Time!, $namespace: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      invocations: durableObjectsInvocationsAdaptiveGroups(
        filter: { datetime_geq: $since, name: $namespace }
        limit: 10000
      ) {
        dimensions { datetimeHour type status }
        sum { requests errors wallTime }
      }
      periodic: durableObjectsPeriodicGroups(
        filter: { datetime_geq: $since, name: $namespace }
        limit: 10000
      ) {
        dimensions { datetimeHour }
        sum {
          duration activeTime cpuTime rowsRead rowsWritten storageDeletes storageReadUnits storageWriteUnits
          inboundWebsocketMsgCount outboundWebsocketMsgCount
        }
      }
    }
  }
}`;

const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { accountTag, since, namespace } }),
});
const payload = await response.json();
if (!response.ok || payload.errors?.length) {
  throw new Error(JSON.stringify(payload.errors ?? payload));
}

const metrics = payload.data?.viewer?.accounts?.[0] ?? { invocations: [], periodic: [] };
const sum = (groups, field) => groups.reduce((total, group) => total + Number(group.sum?.[field] ?? 0), 0);
const summary = {
  requests: sum(metrics.invocations, 'requests'),
  errors: sum(metrics.invocations, 'errors'),
  wallTime: sum(metrics.invocations, 'wallTime'),
  duration: sum(metrics.periodic, 'duration'),
  activeTime: sum(metrics.periodic, 'activeTime'),
  cpuTime: sum(metrics.periodic, 'cpuTime'),
  rowsRead: sum(metrics.periodic, 'rowsRead'),
  rowsWritten: sum(metrics.periodic, 'rowsWritten'),
  storageDeletes: sum(metrics.periodic, 'storageDeletes'),
  storageReadUnits: sum(metrics.periodic, 'storageReadUnits'),
  storageWriteUnits: sum(metrics.periodic, 'storageWriteUnits'),
  inboundWebsocketMsgCount: sum(metrics.periodic, 'inboundWebsocketMsgCount'),
  outboundWebsocketMsgCount: sum(metrics.periodic, 'outboundWebsocketMsgCount'),
};

console.log(JSON.stringify({ since, namespace, summary, ...metrics }, null, 2));
