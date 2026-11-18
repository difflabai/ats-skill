import { appendFileSync, readFileSync } from 'node:fs';

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (name !== '@difflabai/ats-cli' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Expected an ATS CLI release version');
}

const response = await fetch(`https://registry.npmjs.org/@difflabai%2fats-cli/${encodeURIComponent(version)}`, {
  cache: 'no-store',
  redirect: 'error',
  signal: AbortSignal.timeout(15_000),
});
if (response.ok) {
  const published = await response.json();
  if (published.name !== name || published.version !== version) {
    throw new Error('npm returned a different package or version');
  }
  console.log(`${name}@${version} is already published`);
} else if (response.status !== 404) {
  throw new Error(`npm registry returned HTTP ${response.status}`);
}
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nexists=${response.ok}\n`);
