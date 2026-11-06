import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const expoRepository = 'https://github.com/expo/expo.git';
const tabTriggerSourceInExpo = 'packages/expo-router/src/ui/TabTrigger.tsx';
const templateTabsInExpo = 'templates/expo-template-default/src/components/app-tabs.web.tsx';
const installedTabTriggerPath = 'node_modules/expo-router/build/ui/TabTrigger.d.ts';
const tabsPath = 'src/components/app-tabs.web.tsx';
const caseSource = '<Pressable {...props}';

const exitCodes = { fixed: 0, defectShows: 1, stepFailed: 2 };

class StepFailed extends Error {}

function execute(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new StepFailed(`${command} ${commandArguments.join(' ')} did not start: ${result.error.message}`);
  }
  return result;
}

function npm(commandArguments) {
  return process.platform === 'win32'
    ? execute(`npm ${commandArguments.join(' ')}`, [], { shell: true })
    : execute('npm', commandArguments);
}

function readInstalledVersion(packageName) {
  return JSON.parse(readFileSync(`node_modules/${packageName}/package.json`, 'utf8')).version;
}

function parseArguments(commandArguments) {
  if (commandArguments.length === 0) {
    return undefined;
  }
  if (commandArguments.length === 2 && commandArguments[0] === '--tab-trigger') {
    return commandArguments[1];
  }
  throw new StepFailed('usage: node repro.mjs [--tab-trigger <path to a build/ui/TabTrigger.d.ts>]');
}

function slotPropsDeclaration(text) {
  const match = /export type TabTriggerSlotProps =[^;]*?\{[^}]*\};/s.exec(text);
  return match === null ? undefined : match[0].replace(/\s+/g, ' ');
}

async function fetchFromMain(commit, filePath) {
  const url = `https://raw.githubusercontent.com/expo/expo/${commit}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new StepFailed(`GET ${url} answered ${response.status}`);
  }
  return response.text();
}

async function compareWithMain() {
  const lsRemote = execute('git', ['ls-remote', expoRepository, 'refs/heads/main']);
  const commit = lsRemote.stdout.split(/\s/)[0] ?? '';
  if (lsRemote.status !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new StepFailed(`git ls-remote ${expoRepository} refs/heads/main failed: ${lsRemote.stderr.trim()}`);
  }
  const mainDeclaration = slotPropsDeclaration(await fetchFromMain(commit, tabTriggerSourceInExpo));
  const installedDeclaration = slotPropsDeclaration(readFileSync(installedTabTriggerPath, 'utf8'));
  if (mainDeclaration === undefined || installedDeclaration === undefined) {
    throw new StepFailed('TabTriggerSlotProps was not found on main or in the installed expo-router');
  }
  const mainTemplateTabs = await fetchFromMain(commit, templateTabsInExpo);
  const declarationMatches = mainDeclaration === installedDeclaration;
  const templateMatches = mainTemplateTabs === readFileSync(tabsPath, 'utf8');
  console.log(
    `2. expo main is at ${commit.slice(0, 11)}. Its ${tabTriggerSourceInExpo} declares ${mainDeclaration} ${declarationMatches ? 'as' : 'unlike'} ${installedTabTriggerPath}, and its ${templateTabsInExpo} is ${templateMatches ? 'byte-identical to' : 'different from'} ${tabsPath}`
  );
  return { name: `expo main at ${commit.slice(0, 11)}`, standsForMain: declarationMatches && templateMatches };
}

function writeExpoEnvDeclaration() {
  const customize = execute(process.execPath, ['node_modules/expo/bin/cli', 'customize', 'tsconfig.json']);
  if (customize.status !== 0) {
    throw new StepFailed(`expo customize tsconfig.json exited with ${customize.status}:\n${customize.stderr.trim()}`);
  }
  let reference;
  try {
    reference = readFileSync('expo-env.d.ts', 'utf8').split(/\r?\n/)[0];
  } catch {
    throw new StepFailed('expo customize tsconfig.json wrote no expo-env.d.ts');
  }
  console.log(`3. expo customize tsconfig.json wrote expo-env.d.ts: ${reference}`);
}

function parseDiagnostics(output) {
  const diagnostics = [];
  for (const text of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),\d+\): error (TS\d+): /.exec(text);
    if (match) {
      diagnostics.push({ file: match[1], line: Number(match[2]), code: match[3], text, details: [] });
    } else if (text.startsWith(' ') && diagnostics.length > 0) {
      diagnostics.at(-1).details.push(text.trim());
    } else if (text.trim() !== '') {
      diagnostics.push({ file: undefined, line: 0, code: undefined, text, details: [] });
    }
  }
  return diagnostics;
}

function typeCheck() {
  const result = execute(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']);
  const diagnostics = parseDiagnostics(`${result.stdout}\n${result.stderr}`);
  if (result.status === 0 && diagnostics.length === 0) {
    return diagnostics;
  }
  if ((result.status === 1 || result.status === 2) && diagnostics.length > 0) {
    return diagnostics;
  }
  throw new StepFailed(`tsc exited with ${result.status}: ${`${result.stdout}${result.stderr}`.trim()}`);
}

function locateCase() {
  const index = readFileSync(tabsPath, 'utf8')
    .split(/\r?\n/)
    .findIndex((text) => text.includes(caseSource));
  if (index === -1) {
    throw new StepFailed(`${tabsPath} has no line with ${caseSource}`);
  }
  return index + 1;
}

async function main() {
  const tabTriggerArgument = parseArguments(process.argv.slice(2));
  const npmVersion = npm(['--version']).stdout.trim();
  console.log(`System: Node ${process.version}, npm ${npmVersion}, ${os.type()} ${os.release()} ${os.arch()}`);

  const install = npm(['ci', '--no-audit', '--no-fund']);
  if (install.status !== 0) {
    throw new StepFailed(`npm ci exited with ${install.status}:\n${`${install.stdout}${install.stderr}`.trim()}`);
  }
  const versions = ['expo', 'expo-router', 'react-native', 'typescript', '@types/react']
    .map((packageName) => `${packageName} ${readInstalledVersion(packageName)}`)
    .join(', ');
  console.log(`1. npm ci installed ${versions}`);

  const installedTabTrigger = readFileSync(installedTabTriggerPath);
  let underTest;
  if (tabTriggerArgument === undefined) {
    underTest = await compareWithMain();
  } else {
    let replacement;
    try {
      replacement = readFileSync(tabTriggerArgument);
    } catch (error) {
      throw new StepFailed(`--tab-trigger ${tabTriggerArgument} could not be read: ${error.message}`);
    }
    console.log(
      `2. ${tabTriggerArgument} replaces ${installedTabTriggerPath} for this run; it declares ${slotPropsDeclaration(replacement.toString('utf8'))}`
    );
    writeFileSync(installedTabTriggerPath, replacement);
    underTest = { name: tabTriggerArgument, standsForMain: true };
  }

  try {
    writeExpoEnvDeclaration();
    const caseLine = locateCase();
    const diagnostics = typeCheck();
    console.log(`4. tsc --noEmit: ${diagnostics.length} errors`);
    for (const diagnostic of diagnostics) {
      console.log(`   ${diagnostic.text}`);
      for (const detail of diagnostic.details) {
        console.log(`     ${detail}`);
      }
    }
    const caseDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.file === tabsPath && diagnostic.line === caseLine
    );
    const otherDiagnostics = diagnostics.filter((diagnostic) => !caseDiagnostics.includes(diagnostic));
    console.log(
      `Summary: on ${underTest.name}, the default template's ${tabsPath}:${caseLine}, where TabButton spreads TabTriggerSlotProps onto a Pressable, ${caseDiagnostics.length === 0 ? 'type-checks' : `fails with ${caseDiagnostics.map((diagnostic) => diagnostic.code).join(', ')}`}, and tsc reports ${otherDiagnostics.length} other errors`
    );
    if (otherDiagnostics.length > 0) {
      console.log(`Verdict: type checking fails for another reason, exit ${exitCodes.stepFailed}`);
      return exitCodes.stepFailed;
    }
    if (!underTest.standsForMain) {
      console.log(`Verdict: main has changed the declaration or the template, so this run does not stand for it, exit ${exitCodes.stepFailed}`);
      return exitCodes.stepFailed;
    }
    if (caseDiagnostics.length > 0) {
      console.log(`Verdict: the defect shows, exit ${exitCodes.defectShows}`);
      return exitCodes.defectShows;
    }
    console.log(`Verdict: fixed, exit ${exitCodes.fixed}`);
    return exitCodes.fixed;
  } finally {
    writeFileSync(installedTabTriggerPath, installedTabTrigger);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.log(error instanceof StepFailed ? `Step failed: ${error.message}` : `Step failed: ${error.stack}`);
  console.log(`Verdict: a step failed before the check, exit ${exitCodes.stepFailed}`);
  process.exitCode = exitCodes.stepFailed;
}
