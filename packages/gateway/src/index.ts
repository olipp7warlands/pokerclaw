export * from "./billing/pricing.js";
export * from "./billing/token-counter.js";
export * from "./token-ledger.js";
export * from "./auth/api-keys.js";
export * from "./auth/agent-auth.js";
export * from "./poker-integration.js";
export * from "./inference.js";
export * from "./providers/base-provider.js";
export * from "./providers/registry.js";

// Express app (with all routes pre-registered; caller should call app.listen())
export { app } from "./server.js";

// Embeddable router — mount at any prefix, e.g. app.use("/gateway", gatewayRouter)
export { gatewayRouter } from "./server.js";
