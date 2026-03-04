/**
 * agent-registry.ts — runtime lookup for all agents (built-in + custom)
 *
 * Module-level Map so any component can resolve agent display info without
 * prop-drilling. Populated at startup from DEMO_AGENTS; custom agents are
 * added when the user registers them via AddAgentModal.
 */

import type { DemoAgent } from "./constants.js";
import { DEMO_AGENTS }    from "./constants.js";

const _registry = new Map<string, DemoAgent>(
  DEMO_AGENTS.map((a) => [a.id, a])
);

export function registerAgent(agent: DemoAgent): void {
  _registry.set(agent.id, agent);
}

export function lookupAgent(agentId: string): DemoAgent | undefined {
  return _registry.get(agentId);
}

export function getAllAgents(): DemoAgent[] {
  return Array.from(_registry.values());
}
