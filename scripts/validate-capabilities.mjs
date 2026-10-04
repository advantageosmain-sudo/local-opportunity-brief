import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const definitions = [
  {
    skill: 'product-readiness',
    agent: 'product-readiness',
    agentName: 'product_readiness',
    sandbox: 'read-only',
    headings: [
      '## Source inventory and reuse',
      '## Workflow',
      '## Permission boundaries',
      '## Verification example',
      '## Invocation prompt',
    ],
    safetyPhrases: ['owner', 'BLOCKED'],
  },
  {
    skill: 'digital-product-production',
    agent: 'digital-product-producer',
    agentName: 'digital_product_producer',
    sandbox: 'workspace-write',
    headings: [
      '## Existing product architecture to reuse',
      '## Format and production workflow',
      '## Permission boundaries',
      '## Verification example',
      '## Invocation prompt',
    ],
    safetyPhrases: ['owner', 'DRAFT', 'BLOCKED'],
  },
  {
    skill: 'business-records',
    agent: 'business-records-steward',
    agentName: 'business_records_steward',
    sandbox: 'read-only',
    headings: [
      '## Existing record architecture to reuse',
      '## Workflow',
      '## Permission boundaries',
      '## Verification example',
      '## Invocation prompt',
    ],
    safetyPhrases: ['owner', 'missing_anchor'],
  },
];

async function read(relativePath, failures) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return '';
  }
}

function frontmatter(content, relativePath, failures) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    failures.push(`${relativePath}: missing YAML frontmatter.`);
    return {};
  }
  const scalar = (key) => {
    const value = match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    return value?.replace(/^"|"$/g, '') ?? '';
  };
  return { name: scalar('name'), description: scalar('description') };
}

function tomlFields(content, relativePath, failures) {
  const field = (name) => content.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"\\s*$`, 'm'))?.[1] ?? '';
  const instructions = content.match(/^developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""\s*$/m);
  if (!instructions) failures.push(`${relativePath}: malformed developer_instructions multiline value.`);
  return {
    name: field('name'),
    description: field('description'),
    sandbox: field('sandbox_mode'),
    instructions: instructions?.[1] ?? '',
  };
}

export async function validateCapabilities() {
  const failures = [];
  const manifestText = await read('BUSINESS_MANIFEST.json', failures);
  let businessName = '';
  try {
    businessName = JSON.parse(manifestText).business?.name ?? '';
    if (!businessName) failures.push('BUSINESS_MANIFEST.json: missing business.name.');
  } catch {
    failures.push('BUSINESS_MANIFEST.json: invalid JSON.');
  }

  const rootInstructions = await read('AGENTS.md', failures);
  for (const required of ['owner gates', 'GitHub', 'Google Drive', 'Pages']) {
    if (!rootInstructions.includes(required)) failures.push(`AGENTS.md: missing ${required}.`);
  }

  const catalog = await read('docs/CAPABILITY_CATALOG.md', failures);
  const taskRecord = await read('docs/agent-capability-build-2026-10-04.md', failures);
  for (const requiredPath of [
    '.agents/skills/product-readiness/SKILL.md',
    '.agents/skills/digital-product-production/SKILL.md',
    '.agents/skills/business-records/SKILL.md',
    '.codex/agents/product-readiness.toml',
    '.codex/agents/digital-product-producer.toml',
    '.codex/agents/business-records-steward.toml',
  ]) {
    if (!catalog.includes(requiredPath)) failures.push(`docs/CAPABILITY_CATALOG.md: missing ${requiredPath}.`);
  }
  if (!taskRecord.includes('Pages/Drive handoff')) failures.push('Task record: missing Pages/Drive handoff status.');
  if (!taskRecord.includes('Approval state')) failures.push('Task record: missing approval state.');

  for (const definition of definitions) {
    const skillPath = `.agents/skills/${definition.skill}/SKILL.md`;
    const skillContent = await read(skillPath, failures);
    const metadata = frontmatter(skillContent, skillPath, failures);
    if (metadata.name !== definition.skill) failures.push(`${skillPath}: skill name does not match its directory.`);
    if (metadata.description.length < 40) failures.push(`${skillPath}: description is missing or too short.`);
    for (const heading of definition.headings) {
      if (!skillContent.includes(heading)) failures.push(`${skillPath}: missing section ${heading}.`);
    }
    for (const phrase of definition.safetyPhrases) {
      if (!skillContent.toLowerCase().includes(phrase.toLowerCase())) failures.push(`${skillPath}: missing safety/example phrase ${phrase}.`);
    }

    const agentPath = `.codex/agents/${definition.agent}.toml`;
    const agentContent = await read(agentPath, failures);
    const agent = tomlFields(agentContent, agentPath, failures);
    if (agent.name !== definition.agentName) failures.push(`${agentPath}: incorrect agent name.`);
    if (agent.description.length < 40) failures.push(`${agentPath}: description is missing or too short.`);
    if (agent.sandbox !== definition.sandbox) failures.push(`${agentPath}: expected sandbox_mode=${definition.sandbox}.`);
    if (!agent.instructions.includes(`.agents/skills/${definition.skill}/SKILL.md`)) {
      failures.push(`${agentPath}: does not load its paired skill.`);
    }
    if (!agent.instructions.includes('owner')) failures.push(`${agentPath}: missing owner approval boundary.`);
  }

  return { ok: failures.length === 0, failures, skillCount: definitions.length, agentCount: definitions.length, businessName };
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath === fileURLToPath(import.meta.url)) {
  const result = await validateCapabilities();
  if (result.ok) {
    console.log(`Capabilities validated: ${result.skillCount} skills, ${result.agentCount} agents, ${result.businessName}.`);
  } else {
    console.error(result.failures.map((failure) => `- ${failure}`).join('\n'));
    process.exitCode = 1;
  }
}
