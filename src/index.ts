export { scan } from "./core/scan.js";
export { scanWithRanking } from "./core/scan-with-ranking.js";
export {
  isDocumentationPath,
  listDocumentationFiles,
} from "./core/docs.js";
export {
  DEFAULT_DOCS_EXCLUDE,
  DEFAULT_DOCS_INCLUDE,
  resolveDocsDiscoveryOptions,
  parseGlobList,
} from "./core/docs-config.js";
export {
  DEFAULT_CODE_EXCLUDE,
  DEFAULT_DOCS_SYNC_IGNORE,
  SURFACE_KINDS,
  createDefaultDocsSyncConfig,
  parseDocsSyncBoolean,
  parseDocsSyncEnv,
  parseDocsSyncSection,
  resolveDocsSyncConfig,
} from "./core/docs-sync-config.js";
export {
  COMMON_SURFACE_WORDS,
  isCommonSurfaceWord,
} from "./docs-sync/common-words.js";
export type {
  ChangeKind,
  DetectorConfig,
  DocsSyncConfig,
  DocsSyncConfigFile,
  DocsSyncOverrides,
  DocsSyncRule,
  SurfaceKind,
} from "./core/docs-sync-config.js";
export { prepareDocumentationContent } from "./core/doc-content.js";
export { ScanError } from "./errors.js";
export { formatJson } from "./reporters/json.js";
export { formatSarif } from "./reporters/sarif.js";
export { formatText } from "./reporters/text.js";
export { exitCodeFor } from "./reporters/exit-code.js";
export { formatCommentBody, STICKY_COMMENT_MARKER } from "./action/comment.js";
export { formatJobSummary } from "./action/summary.js";
export { parseActionInputs, formatGithubOutputs } from "./action/inputs.js";
export { runAction } from "./action/run.js";
export { createDocLagMcpServer } from "./mcp/server.js";
export { runMcpStdio } from "./mcp/stdio.js";
export {
  handleScanDiff,
  handleExplainFinding,
  handleListRules,
} from "./mcp/handlers.js";
export { listRules } from "./mcp/rules.js";
export { applyJevRanking, parseRankProvider } from "./ranking/jev-rank.js";
export {
  buildScoreRequest,
  estimateCostUsd,
  scoreWithJev,
} from "./ranking/jev-client.js";
export { redactSecrets } from "./ranking/redact.js";
export {
  JEV_MODEL,
  JEV_PRIVACY_NOTICE,
  TYPESAFE_API_KEY_ENV,
} from "./ranking/constants.js";
export { SCHEMA_VERSION, TOOL_NAME } from "./types.js";
export type {
  DocsDiscoveryOptions,
  DocsSyncInfo,
  FailOn,
  Finding,
  FindingRanking,
  OutputFormat,
  RankProvider,
  RankingInfo,
  ScanOptions,
  ScanReport,
  SurfaceInfo,
} from "./types.js";
export { runDocsSync } from "./docs-sync/engine.js";
export {
  listRegisteredDetectors,
  REGISTERED_DETECTOR_KINDS,
  STRUCTURED_DETECTOR_KINDS,
} from "./docs-sync/detectors/registry.js";
export type { SurfaceDecl, MentionContext } from "./docs-sync/detectors/types.js";
export { STRUCTURED_MENTION_CONTEXTS } from "./docs-sync/detectors/types.js";
export { extractBoldSpans } from "./docs-sync/mention-index.js";
export {
  CAT_FILE_CHUNK_BUDGET_BYTES,
  CAT_FILE_MAX_OBJECT_BYTES,
} from "./core/git-helpers.js";
export type { RuleInfo } from "./mcp/rules.js";
export type { McpHandlerContext } from "./mcp/handlers.js";
export type { ScanWithRankingOptions } from "./core/scan-with-ranking.js";
