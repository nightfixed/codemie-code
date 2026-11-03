import { describe, expect, it } from 'vitest';
import { ClaudeAcpPlugin } from '../claude-acp.plugin.js';

describe('ClaudeAcpPlugin dry-run describe seams', () => {
  it('describeInstall names the ACP npm package, never the native installer', () => {
    const plugin = new ClaudeAcpPlugin();

    const plan = plugin.describeInstall();

    expect(plan).toEqual([
      expect.objectContaining({
        kind: 'install',
        targets: expect.arrayContaining(['@agentclientprotocol/claude-agent-acp']),
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('native installer');
  });

  it('describeUninstall names the ACP npm package', () => {
    const plugin = new ClaudeAcpPlugin();

    const plan = plugin.describeUninstall();

    expect(plan).toEqual([
      expect.objectContaining({
        kind: 'remove',
        targets: expect.arrayContaining(['@agentclientprotocol/claude-agent-acp']),
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('@anthropic-ai/claude-code');
  });
});
