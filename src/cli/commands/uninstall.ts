import { Command } from 'commander';
import { join } from 'path';
import { AgentRegistry } from '@/agents/registry.js';
import { getAgentUninstallCommand, getUserFacingAgentName, resolveAgentAlias } from '@/agents/core/agent-aliases.js';
import { AgentNotFoundError, getErrorMessage } from '@/utils/errors.js';
import { resolveHomeDir } from '@/utils/paths.js';
import {
  STATUSLINE_NAME,
  STATUSLINE_DISPLAY_NAME,
  uninstallStatusline,
  isStatuslineInstalled,
} from '@/agents/plugins/claude/statusline-installer.js';
import { printEndCap, printPlannedActions, type PlannedAction } from './shared/dry-run.js';
import ora from 'ora';
import chalk from 'chalk';

export function createUninstallCommand(): Command {
  const command = new Command('uninstall');

  command
    .description('Uninstall an AI agent or framework')
    .argument('[name]', 'Agent or framework name to uninstall (run without argument to see installed)')
    .action(async (name?: string, options?: { dryRun?: boolean }) => {
      try {
        // Dry run: describe the plan and stop before any side effect. Inside the
        // try so a throw from a describe implementation is caught, printed, and
        // still ends with the failure end-cap instead of becoming an unhandled
        // rejection (AC8).
        if (options?.dryRun) {
          await buildPreviewPlanUninstall(name);
          return;
        }

        // If no name provided, show installed agents and frameworks
        if (!name) {
          const installedAgents = await AgentRegistry.getInstalledAgents();

          // Get installed frameworks
          const { FrameworkRegistry } = await import('../../frameworks/index.js');
          const frameworks = FrameworkRegistry.getAllFrameworks();
          const installedFrameworkChecks = await Promise.all(
            frameworks.map(async (fw) => ({
              framework: fw,
              installed: await fw.isInstalled()
            }))
          );
          const installedFrameworks = installedFrameworkChecks
            .filter(({ installed }) => installed)
            .map(({ framework }) => framework);

          if (installedAgents.length === 0 && installedFrameworks.length === 0) {
            console.log();
            console.log(chalk.yellow('No agents or frameworks are currently installed.'));
            console.log();
            console.log(chalk.cyan('💡 Tip:') + ' Run ' + chalk.blueBright('codemie list') + ' to see all available items');
            console.log();
            return;
          }

          console.log();

          if (installedAgents.length > 0) {
            console.log(chalk.bold('📦 Installed Agents:\n'));

            for (const agent of installedAgents) {
              const version = await agent.getVersion();
              const versionStr = version ? chalk.white(` (${version})`) : '';

              console.log(chalk.bold(`  ${agent.displayName}`) + versionStr);
              console.log(`    Command: ${chalk.cyan(getAgentUninstallCommand(agent.name))}`);
              console.log(`    ${chalk.white(agent.description)}`);
              console.log();
            }
          }

          if (installedFrameworks.length > 0) {
            console.log(chalk.bold('🛠️  Installed Frameworks:\n'));

            for (const framework of installedFrameworks) {
              const version = await framework.getVersion();
              const versionStr = version ? chalk.white(` v${version}`) : '';

              console.log(chalk.bold(`  ${framework.metadata.displayName}`) + versionStr);
              console.log(`    Command: ${chalk.cyan(`codemie uninstall ${framework.metadata.name}`)}`);
              console.log(`    ${chalk.white(framework.metadata.description)}`);
              console.log();
            }
          }

          console.log(chalk.cyan('💡 Tip:') + ' Run ' + chalk.blueBright('codemie uninstall <name>') + ' to uninstall');
          console.log();
          return;
        }

        // Try agent first
        const canonicalName = resolveAgentAlias(name) || name;
        const agent = AgentRegistry.getAgent(canonicalName);

        if (agent) {
          // Check if installed
          if (!(await agent.isInstalled())) {
            console.log(chalk.blueBright(`${agent.displayName} is not installed`));
            return;
          }

          const spinner = ora(`Uninstalling ${agent.displayName}...`).start();

          try {
            await agent.uninstall();
            spinner.succeed(`${agent.displayName} uninstalled successfully`);
          } catch (error: unknown) {
            spinner.fail(`Failed to uninstall ${agent.displayName}`);
            throw error;
          }
          return;
        }

        // Try framework
        const { FrameworkRegistry } = await import('../../frameworks/index.js');
        const framework = FrameworkRegistry.getFramework(name);

        if (framework) {
          // Check if installed
          if (!(await framework.isInstalled())) {
            console.log(chalk.blueBright(`${framework.metadata.displayName} is not installed`));
            return;
          }

          const spinner = ora(`Uninstalling ${framework.metadata.displayName}...`).start();

          try {
            await framework.uninstall();
            spinner.succeed(`${framework.metadata.displayName} uninstalled successfully`);
          } catch (error: unknown) {
            spinner.fail(`Failed to uninstall ${framework.metadata.displayName}`);
            throw error;
          }
          return;
        }

        if (name === STATUSLINE_NAME) {
          if (!isStatuslineInstalled()) {
            console.log(chalk.blueBright(`${STATUSLINE_DISPLAY_NAME} is not installed`));
            return;
          }

          const spinner = ora(`Uninstalling ${STATUSLINE_DISPLAY_NAME}...`).start();
          try {
            await uninstallStatusline();
            spinner.succeed(`${STATUSLINE_DISPLAY_NAME} uninstalled`);
          } catch (error: unknown) {
            spinner.fail(`Failed to uninstall ${STATUSLINE_DISPLAY_NAME}`);
            throw error;
          }
          return;
        }

        // Neither agent nor framework found
        throw new AgentNotFoundError(name);
      } catch (error: unknown) {
        // Handle AgentNotFoundError with helpful suggestions
        if (error instanceof AgentNotFoundError) {
          await printUnknownUninstallTarget(getErrorMessage(error));
          printEndCap();
          process.exitCode = 1;
          return;
        }

        // For other errors, show simple message
        console.error(chalk.red(`✗ Uninstallation failed: ${getErrorMessage(error)}`));
        printEndCap();
        process.exitCode = 1;
      }
    });

  return command;
}

/** One shared line for "there is nothing to uninstall under that name". */
async function printUnknownUninstallTarget(message: string): Promise<void> {
  console.error(chalk.red(`✗ ${message}`));
  console.log();
  console.log(chalk.cyan('💡 Available agents and frameworks:'));
  const allAgents = AgentRegistry.getManageableAgents();
  for (const agent of allAgents) {
    console.log(chalk.white(`   • ${getUserFacingAgentName(agent.name)}`));
  }

  const { FrameworkRegistry } = await import('../../frameworks/index.js');
  for (const framework of FrameworkRegistry.getAllFrameworks()) {
    console.log(chalk.white(`   • ${framework.metadata.name}`));
  }

  console.log();
  console.log(chalk.cyan('💡 Tip:') + ' Run ' + chalk.blueBright('codemie uninstall') + ' to see installed items');
  console.log();
}

/** The read-only listing `codemie uninstall` prints when no name is given. */
async function describeInstalledListing(): Promise<PlannedAction> {
  const installedAgents = await AgentRegistry.getInstalledAgents();

  return {
    kind: 'exec',
    label: 'List installed agents and frameworks (read-only)',
    targets: [
      `${installedAgents.length} installed agents`,
      'framework install status (read-only check)',
    ],
  };
}

/**
 * What `uninstallStatusline()` removes: the deployed script, the legacy script
 * from the old `--status` mechanism, and the `statusLine` entry in settings.
 */
function describeStatuslineUninstall(): PlannedAction {
  const claudeHome = resolveHomeDir('.claude');

  return {
    kind: 'remove',
    label: `Remove the ${STATUSLINE_DISPLAY_NAME} script and its Claude Code settings entry`,
    targets: [
      join(claudeHome, 'codemie-budget-status.js'),
      `${join(claudeHome, 'codemie-statusline.mjs')} (legacy script, if present)`,
      `${join(claudeHome, 'settings.json')} (statusLine entry)`,
    ],
  };
}

/**
 * Prints the `codemie uninstall --dry-run` plan. Describe-only: it never removes,
 * writes, or reaches the network.
 */
async function buildPreviewPlanUninstall(name?: string): Promise<void> {
  if (!name) {
    printPlannedActions([await describeInstalledListing()]);
    printEndCap();
    process.exitCode = 0;
    return;
  }

  const canonicalName = resolveAgentAlias(name) || name;

  if (name === STATUSLINE_NAME) {
    printPlannedActions([describeStatuslineUninstall()]);
    printEndCap();
    process.exitCode = 0;
    return;
  }

  const agent = AgentRegistry.getAgent(canonicalName);

  if (agent) {
    printPlannedActions(agent.describeUninstall());
    printEndCap();
    process.exitCode = 0;
    return;
  }

  const { FrameworkRegistry } = await import('../../frameworks/index.js');
  const framework = FrameworkRegistry.getFramework(name);

  if (framework) {
    printPlannedActions(framework.describeUninstall());
    printEndCap();
    process.exitCode = 0;
    return;
  }

  await printUnknownUninstallTarget(getErrorMessage(new AgentNotFoundError(name)));
  printEndCap();
  process.exitCode = 1;
}
