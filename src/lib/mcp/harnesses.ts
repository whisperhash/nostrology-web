// Per-harness registration instructions for the Nostrology MCP server.
//
// Every snippet below was verified against the harness's own documentation on
// 2026-07-30 (not reconstructed from memory) - if a harness changes its config
// shape, fix it HERE and the /data page follows. Order: Claude Code, Codex,
// Hermes, OpenCode (per the operator's priority list), then rough adoption
// order. Pi (pi.dev) is deliberately ABSENT: it has no MCP support by design
// ("No MCP - build CLI tools with READMEs, or build an extension").
//
// Two shapes cover everything: harnesses with native Streamable-HTTP support
// take the URL directly; stdio-only harnesses go through the mcp-remote shim
// (the generic fallback the page leads with).

export interface Harness {
	id: string;
	name: string;
	/** Where the snippet goes: a shell command vs a config file (path shown). */
	kind: 'command' | 'config';
	configPath?: string;
	language: 'bash' | 'json' | 'yaml' | 'toml' | 'text';
	snippet: (endpoint: string) => string;
	note?: string;
}

export const HARNESSES: Harness[] = [
	{
		id: 'claude-code',
		name: 'Claude Code',
		kind: 'command',
		language: 'bash',
		snippet: (e) => `claude mcp add --transport http nostrology ${e}`,
		note: 'Applies to new sessions. An agent with shell access can run this itself.'
	},
	{
		id: 'codex',
		name: 'Codex CLI',
		kind: 'config',
		configPath: '~/.codex/config.toml',
		language: 'toml',
		snippet: (e) => `[mcp_servers.nostrology]\nurl = "${e}"`
	},
	{
		id: 'hermes',
		name: 'Hermes Agent',
		kind: 'config',
		configPath: '~/.hermes config.yaml (or: hermes mcp)',
		language: 'yaml',
		snippet: (e) => `mcp_servers:\n  nostrology:\n    url: "${e}"`,
		note: 'MCP support ships with the standard install; /reload-mcp applies config edits.'
	},
	{
		id: 'opencode',
		name: 'OpenCode',
		kind: 'config',
		configPath: 'opencode.json',
		language: 'json',
		snippet: (e) =>
			JSON.stringify(
				{ mcp: { nostrology: { type: 'remote', url: e, enabled: true } } },
				null,
				2
			)
	},
	{
		id: 'claude-desktop',
		name: 'Claude Desktop / claude.ai',
		kind: 'config',
		language: 'text',
		snippet: (e) => `Settings -> Connectors -> Add custom connector -> URL: ${e}`
	},
	{
		id: 'cursor',
		name: 'Cursor',
		kind: 'config',
		configPath: '~/.cursor/mcp.json (or .cursor/mcp.json per-project)',
		language: 'json',
		snippet: (e) => JSON.stringify({ mcpServers: { nostrology: { url: e } } }, null, 2)
	},
	{
		id: 'vscode',
		name: 'VS Code (Copilot agent mode)',
		kind: 'config',
		configPath: '.vscode/mcp.json (or MCP: Add Server)',
		language: 'json',
		snippet: (e) =>
			JSON.stringify({ servers: { nostrology: { type: 'http', url: e } } }, null, 2)
	},
	{
		id: 'cline',
		name: 'Cline',
		kind: 'config',
		configPath: 'cline_mcp_settings.json',
		language: 'json',
		snippet: (e) =>
			JSON.stringify(
				{ mcpServers: { nostrology: { type: 'streamableHttp', url: e } } },
				null,
				2
			),
		note: 'type streamableHttp matters: omitting it falls back to legacy SSE.'
	},
	{
		id: 'windsurf',
		name: 'Windsurf',
		kind: 'config',
		configPath: 'mcp_config.json',
		language: 'json',
		snippet: (e) => JSON.stringify({ mcpServers: { nostrology: { serverUrl: e } } }, null, 2)
	},
	{
		id: 'zed',
		name: 'Zed',
		kind: 'config',
		configPath: 'settings.json (Settings -> AI -> MCP Servers -> Add Remote Server)',
		language: 'json',
		snippet: (e) => JSON.stringify({ context_servers: { nostrology: { url: e } } }, null, 2)
	},
	{
		id: 'goose',
		name: 'Goose',
		kind: 'config',
		configPath: '~/.config/goose/config.yaml',
		language: 'yaml',
		snippet: (e) =>
			`extensions:\n  nostrology:\n    type: streamable_http\n    enabled: true\n    name: nostrology\n    uri: ${e}\n    timeout: 300`,
		note: 'One-off alternative: goose session --with-streamable-http-extension <the endpoint URL above>'
	},
	{
		id: 'gemini-cli',
		name: 'Gemini CLI',
		kind: 'command',
		language: 'bash',
		snippet: (e) => `gemini mcp add --transport http nostrology ${e}`
	},
	{
		id: 'continue',
		name: 'Continue',
		kind: 'config',
		configPath: 'config.yaml',
		language: 'yaml',
		snippet: (e) => `mcpServers:\n  - name: Nostrology\n    type: streamable-http\n    url: ${e}`
	}
];

/** The universal fallback for stdio-only harnesses: bridge the remote endpoint
 * into a local stdio server via mcp-remote. */
export function stdioShim(endpoint: string): string {
	return `npx mcp-remote ${endpoint}`;
}
