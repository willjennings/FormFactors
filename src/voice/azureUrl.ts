/** Build the Azure GA realtime WebSocket URL from whatever endpoint form the user pasted.
 *  The Azure portal offers several endpoint shapes (bare resource, Foundry project path
 *  `/api/projects/<name>`); only the bare resource host serves `/openai/v1/realtime` —
 *  a project path rides into the WS URL and the upgrade fails 400 → browser ws close 1006.
 *  Normalizing here makes every pasted form work. Pure; unit-tested. */
export function azureRealtimeUrl(endpoint: string, deployment: string, apiKey: string): string {
  const host = endpoint
    .replace(/^\w+:\/\//, '') // any protocol
    .split('/')[0];           // drop any path (e.g. /api/projects/<name>)
  return `wss://${host}/openai/v1/realtime?model=${encodeURIComponent(deployment)}&api-key=${encodeURIComponent(apiKey)}`;
}
